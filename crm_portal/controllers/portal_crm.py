import logging
from odoo import http, fields
from odoo.http import request
from odoo.addons.portal.controllers.portal import CustomerPortal
from odoo.addons.website.controllers.main import Website
from odoo.tools import html2plaintext, plaintext2html

_logger = logging.getLogger(__name__)


class CRMWebsite(Website):

    def _login_redirect(self, uid, redirect=None):
        user = request.env['res.users'].browse(uid)

        # Admin OR Portal User -> CRM Portal
        if (
                request.params.get('login_success')
                and (
                user.has_group('base.group_system')
                or user.has_group('base.group_portal')
        )
        ):
            redirect = '/my/leads'

        return super()._login_redirect(uid, redirect=redirect)


class CRMPortal(CustomerPortal):

    # =========================================================
    # PORTAL HOME
    # =========================================================

    def _prepare_home_portal_values(self, counters):

        values = super()._prepare_home_portal_values(counters)

        if 'lead_count' in counters:

            user = request.env.user
            Lead = request.env['crm.lead'].sudo()

            lead_domain = [('type', '=', 'lead')]
            if not user.has_group('base.group_system'):
                lead_domain.append(('user_id', '=', user.id))

            values['lead_count'] = Lead.search_count(lead_domain)

        return values

    # =========================================================
    # CHECK LEAD ACCESS
    # =========================================================

    def _check_lead_access(self, lead):

        user = request.env.user

        if not lead.exists():
            return False

        # Administrator
        if user.has_group('base.group_system'):
            return True

        # User can access own leads, created leads, or partner leads
        return (
            lead.user_id.id == user.id or
            lead.create_uid.id == user.id or
            (lead.partner_id and user.partner_id and lead.partner_id.id == user.partner_id.id)
        )

    # =========================================================
    # GET LEAD DOMAIN
    # =========================================================

    def _get_lead_domain(self):

        user = request.env.user

        if user.has_group('base.group_system') or user.has_group('sales_team.group_sale_manager'):
            return []

        return [
            '|', '|',
            ('user_id', '=', user.id),
            ('create_uid', '=', user.id),
            ('partner_id', '=', user.partner_id.id if user.partner_id else False),
        ]

    # =========================================================
    # CRM PIPELINE
    # =========================================================

    @http.route(
        '/my/leads',
        type='http',
        auth='user',
        website=True
    )
    def portal_my_leads(self, **kwargs):
        user = request.env.user

        Lead = request.env[
            'crm.lead'
        ].sudo()

        Stage = request.env[
            'crm.stage'
        ].sudo()

        Team = request.env[
            'crm.team'
        ].sudo()

        Tag = request.env[
            'crm.tag'
        ].sudo()

        User = request.env[
            'res.users'
        ].sudo()

        Country = request.env[
            'res.country'
        ].sudo()

        State = request.env[
            'res.country.state'
        ].sudo()

        Industry = request.env[
            'res.partner.industry'
        ].sudo()

        # -----------------------------------------------------
        # LOST LEADS VIEW
        # -----------------------------------------------------

        # -----------------------------------------------------
        # LOST LEADS & OPPORTUNITIES VIEWS
        # -----------------------------------------------------

        domain = self._get_lead_domain()

        if request.httprequest.args.get('stage') == 'lost_leads':
            lost_domain = domain + [
                ('type', '=', 'lead'),
                ('active', '=', False),
                ('lost_reason_id', '!=', False),
            ]

            lost_leads = Lead.with_context(
                active_test=False
            ).search(
                lost_domain,
                order='write_date desc, id desc'
            )

            from datetime import datetime
            curr_month = datetime.now().strftime('%Y-%m')
            lost_this_month = len([
                l for l in lost_leads
                if (l.date_closed or l.write_date) and (l.date_closed or l.write_date).strftime('%Y-%m') == curr_month
            ])
            reason_names = [l.lost_reason_id.name for l in lost_leads if l.lost_reason_id]
            top_reason = None
            top_reason_count = 0
            if reason_names:
                top_reason = max(set(reason_names), key=reason_names.count)
                top_reason_count = reason_names.count(top_reason)

            return request.render(
                'crm_portal.portal_lost_leads',
                {
                    'lost_leads': lost_leads,
                    'lost_this_month': lost_this_month,
                    'top_reason': top_reason,
                    'top_reason_count': top_reason_count,
                }
            )

        if request.httprequest.args.get('stage') == 'lost':
            lost_domain = domain + [
                ('type', '!=', 'lead'),
                ('active', '=', False),
                ('lost_reason_id', '!=', False),
            ]

            lost_leads = Lead.with_context(
                active_test=False
            ).search(
                lost_domain,
                order='write_date desc, id desc'
            )

            total_lost_revenue = sum(lost_leads.mapped('expected_revenue'))
            currency_symbol = request.env.company.currency_id.symbol or '$'
            formatted_total_revenue = (
                f"{currency_symbol}{total_lost_revenue:,.0f}"
                if total_lost_revenue == int(total_lost_revenue)
                else f"{currency_symbol}{total_lost_revenue:,.2f}"
            )

            reason_names = [l.lost_reason_id.name for l in lost_leads if l.lost_reason_id]
            top_reason = None
            top_reason_count = 0
            if reason_names:
                top_reason = max(set(reason_names), key=reason_names.count)
                top_reason_count = reason_names.count(top_reason)

            return request.render(
                'crm_portal.portal_lost_opportunities',
                {
                    'lost_leads': lost_leads,
                    'total_lost_revenue': total_lost_revenue,
                    'formatted_total_revenue': formatted_total_revenue,
                    'currency_symbol': currency_symbol,
                    'top_reason': top_reason,
                    'top_reason_count': top_reason_count,
                }
            )

        if request.httprequest.args.get('stage') == 'won':
            won_domain = domain + [
                ('type', '!=', 'lead'),
                '|', ('stage_id.is_won', '=', True), ('probability', '=', 100),
            ]

            won_leads = Lead.search(
                won_domain,
                order='write_date desc, id desc'
            )

            return request.render(
                'crm_portal.portal_won_leads',
                {
                    'won_leads': won_leads,
                }
            )

        # -----------------------------------------------------
        # ACTIVE LEADS & PIPELINE OPPORTUNITIES
        # -----------------------------------------------------

        crm_leads = Lead.search(
            domain + [('type', '=', 'lead')],
            order='create_date desc, id desc'
        )

        opp_leads = Lead.search(
            domain + [('type', '!=', 'lead')],
            order='create_date desc, id desc'
        )

        leads = Lead.search(
            domain,
            order='create_date desc, id desc'
        )

        # -----------------------------------------------------
        # STAGES
        # -----------------------------------------------------

        stages = Stage.search(
            [],
            order='sequence, id'
        )

        leads_by_stage = {}

        for stage in stages:
            leads_by_stage[stage.id] = opp_leads.filtered(
                lambda lead: lead.stage_id.id == stage.id
            )

        # -----------------------------------------------------
        # FORM DATA
        # -----------------------------------------------------

        teams = Team.search(
            [],
            order='name'
        )

        tags = Tag.search(
            [],
            order='name'
        )

        users = User.search([('active', '=', True)], order='name')

        countries = Country.search(
            [],
            order='name'
        )

        states = State.search(
            [],
            order='name'
        )

        industries = Industry.search(
            [],
            order='name'
        )

        # Count actual opportunities (type = 'opportunity') for the Total Opportunities KPI card
        user = request.env.user
        lead_domain = [('type', '=', 'lead')]
        opp_domain = [('type', '=', 'opportunity')]
        if not user.has_group('base.group_system'):
            lead_domain.append(('user_id', '=', user.id))
            opp_domain.append(('user_id', '=', user.id))

        total_leads_count = Lead.search_count(lead_domain)
        total_opportunities_count = Lead.search_count(opp_domain)

        from datetime import datetime
        now = datetime.now()
        first_day_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        leads_month_domain = lead_domain + [('create_date', '>=', first_day_of_month)]
        leads_this_month_count = Lead.search_count(leads_month_domain)

        converted_domain = [('type', '=', 'opportunity'), ('date_conversion', '!=', False)]
        if not user.has_group('base.group_system'):
            converted_domain.append(('user_id', '=', user.id))
        converted_leads_count = Lead.search_count(converted_domain)

        total_leads_for_rate = total_leads_count + converted_leads_count
        conversion_rate = round(converted_leads_count / total_leads_for_rate * 100, 1) if total_leads_for_rate else 0.0

        won_domain = [('type', '=', 'opportunity'), '|', ('stage_id.is_won', '=', True), ('probability', '=', 100)]
        if not user.has_group('base.group_system'):
            won_domain.append(('user_id', '=', user.id))
        won_opps = Lead.search(won_domain)
        calc_won_revenue = sum(won_opps.mapped('expected_revenue'))
        calc_won_count = len(won_opps)

        avail_opp_domain = [
            ('type', '=', 'opportunity'),
            ('stage_id.is_won', '=', False),
            ('probability', '<', 100),
        ]
        if user.share:
            avail_opp_domain.append(('user_id', '=', user.id))
        available_opportunities = Lead.search(avail_opp_domain, order='create_date desc, id desc', limit=100)

        Partner = request.env['res.partner'].sudo()
        partners = Partner.search([('active', '=', True)], order='name', limit=200)
        company_partners = Partner.search([('is_company', '=', True), ('active', '=', True)], order='name', limit=200)

        return request.render(
            'crm_portal.portal_my_leads',
            {
                'leads': leads,
                'crm_leads': crm_leads,
                'total_leads_count': total_leads_count,
                'leads_this_month_count': leads_this_month_count,
                'converted_leads_count': converted_leads_count,
                'conversion_rate': conversion_rate,
                'total_opportunities_count': total_opportunities_count,
                'calc_won_revenue': calc_won_revenue,
                'calc_won_count': calc_won_count,
                'stages': stages,
                'leads_by_stage': leads_by_stage,

                'teams': teams,
                'tags': tags,
                'users': users,
                'countries': countries,
                'states': states,
                'industries': industries,
                'partners': partners,
                'company_partners': company_partners,
                'available_opportunities': available_opportunities,
            }
        )

    @http.route(
        '/my/lost-leads',
        type='http',
        auth='user',
        website=True
    )
    def portal_my_lost_leads(self, **kwargs):
        return request.redirect('/my/leads?stage=lost_leads')

    @http.route(
        '/my/lost-opportunities',
        type='http',
        auth='user',
        website=True
    )
    def portal_my_lost_opportunities(self, **kwargs):
        return request.redirect('/my/leads?stage=lost')

    # =========================================================
    # QUICK CREATE LEAD
    # =========================================================

    @http.route(
        '/my/leads/quick-create',
        type='http',
        auth='user',
        website=True,
        methods=['POST']
    )
    def portal_quick_create_lead(
            self,
            **post
    ):
        user = request.env.user

        Lead = request.env[
            'crm.lead'
        ].sudo()

        Partner = request.env[
            'res.partner'
        ].sudo()

        company_name = post.get(
            'company_name',
            ''
        ).strip()

        contact_name = post.get(
            'contact_name',
            ''
        ).strip()

        name = post.get(
            'name',
            ''
        ).strip()

        email_from = post.get(
            'email_from',
            ''
        ).strip()

        phone = post.get(
            'phone',
            ''
        ).strip()

        expected_revenue = post.get(
            'expected_revenue',
            '0'
        ).strip()

        probability = post.get(
            'probability',
            '0'
        ).strip()

        priority = post.get(
            'priority',
            '0'
        ).strip()

        stage_id = post.get(
            'stage_id',
            ''
        ).strip()

        # -----------------------------------------------------
        # REVENUE
        # -----------------------------------------------------

        try:
            expected_revenue = float(
                expected_revenue or 0
            )
        except (
                ValueError,
                TypeError
        ):
            expected_revenue = 0.0

        # -----------------------------------------------------
        # PROBABILITY
        # -----------------------------------------------------

        try:
            probability = float(
                probability or 0
            )
        except (
                ValueError,
                TypeError
        ):
            probability = 0.0

        probability = max(
            0.0,
            min(
                100.0,
                probability
            )
        )

        # -----------------------------------------------------
        # STAGE
        # -----------------------------------------------------

        try:
            stage_id = int(stage_id)
        except (
                ValueError,
                TypeError
        ):
            stage_id = False

        # -----------------------------------------------------
        # DETERMINE RECORD TYPE & ASSIGNMENT
        # -----------------------------------------------------

        user = request.env.user
        req_type = post.get('type')
        if not req_type:
            if 'crm-leads' in (post.get('redirect') or request.httprequest.referrer or ''):
                req_type = 'lead'
            else:
                req_type = 'opportunity'

        assign_user_id = False
        if post.get('user_id') and str(post.get('user_id')).isdigit():
            assign_user_id = int(post.get('user_id'))
        elif post.get('salesperson_id') and str(post.get('salesperson_id')).isdigit():
            assign_user_id = int(post.get('salesperson_id'))
        else:
            assign_user_id = user.id

        # -----------------------------------------------------
        # COMPANY & CONTACT PARTNER RESOLUTION
        # -----------------------------------------------------

        company_partner = False
        contact_partner = False
        lead_partner = False

        explicit_partner_id = post.get('partner_id')
        if explicit_partner_id and str(explicit_partner_id).isdigit():
            explicit_partner = Partner.browse(int(explicit_partner_id))
            if explicit_partner.exists():
                lead_partner = explicit_partner

        # For leads, DO NOT automatically create contact or company partner records.
        # Store company_name and contact_name directly on the lead record.
        # Contacts will only be linked or created when explicitly required by existing
        # CRM workflow (such as converting the lead to opportunity or marking won).
        if req_type != 'lead' and not lead_partner:
            if company_name:
                company_partner = Partner.search(
                    [
                        ('name', '=ilike', company_name),
                        ('is_company', '=', True)
                    ],
                    limit=1
                )
            if contact_name:
                contact_domain = [
                    ('name', '=ilike', contact_name),
                    ('is_company', '=', False)
                ]
                if company_partner:
                    contact_domain.append(('parent_id', '=', company_partner.id))
                contact_partner = Partner.search(contact_domain, limit=1)

            lead_partner = contact_partner or company_partner

        # -----------------------------------------------------
        # CREATE VALUES
        # -----------------------------------------------------

        values = {
            'name':
                name or ('New Opportunity' if req_type == 'opportunity' else 'New Lead'),

            'type':
                req_type,

            'partner_id':
                lead_partner.id if lead_partner else False,

            'partner_name':
                company_name or (company_partner.name if company_partner else False),

            'contact_name':
                contact_name or (contact_partner.name if contact_partner else False),

            'email_from': email_from or False,
            'phone': phone or False,
            'expected_revenue': expected_revenue,
            'street': post.get('street', '').strip() or False,
            'street2': post.get('street2', '').strip() or False,
            'city': post.get('city', '').strip() or False,
            'zip': post.get('zip', '').strip() or False,
            'website': post.get('website', '').strip() or False,
            'function': post.get('function', '').strip() or False,
            'description': post.get('description', '').strip() or False,
        }

        if post.get('date_deadline'):
            values['date_deadline'] = post.get('date_deadline').strip()

        if assign_user_id:
            values['user_id'] = assign_user_id

        if 'probability' in post and post.get('probability') != '':
            values['probability'] = probability

        if post.get('state_id') and str(post.get('state_id')).isdigit():
            values['state_id'] = int(post.get('state_id'))
        if post.get('country_id') and str(post.get('country_id')).isdigit():
            values['country_id'] = int(post.get('country_id'))
        if post.get('team_id') and str(post.get('team_id')).isdigit():
            values['team_id'] = int(post.get('team_id'))

        tag_ids = [int(tid) for tid in request.httprequest.form.getlist('tag_ids') if tid and str(tid).isdigit()]
        if tag_ids:
            values['tag_ids'] = [(6, 0, tag_ids)]

        if priority in ('0', '1', '2', '3'):
            values['priority'] = priority
        else:
            values['priority'] = '0'

        # -----------------------------------------------------
        # STAGE
        # -----------------------------------------------------

        Stage = request.env['crm.stage'].sudo()
        first_stage = Stage.search([], order='sequence, id', limit=1)
        if stage_id:
            stage = Stage.browse(stage_id)
            if stage.exists():
                values['stage_id'] = stage.id

        if req_type == 'opportunity' and not values.get('stage_id') and first_stage:
            values['stage_id'] = first_stage.id

        # -----------------------------------------------------
        # CREATE
        # -----------------------------------------------------

        created_lead = False
        try:
            created_lead = Lead.create(values)
        except Exception as e:
            _logger.exception("Error in portal_quick_create_lead Lead.create: %s", e)
            try:
                minimal_vals = {
                    'name': values['name'],
                    'type': req_type,
                    'expected_revenue': expected_revenue,
                    'priority': values.get('priority', '0'),
                }
                if values.get('stage_id'):
                    minimal_vals['stage_id'] = values['stage_id']
                elif req_type == 'opportunity' and first_stage:
                    minimal_vals['stage_id'] = first_stage.id
                if assign_user_id:
                    minimal_vals['user_id'] = assign_user_id
                if lead_partner:
                    minimal_vals['partner_id'] = lead_partner.id
                created_lead = Lead.create(minimal_vals)
            except Exception as e2:
                _logger.exception("Error creating fallback lead: %s", e2)

        if created_lead:
            updates = {}
            if req_type == 'opportunity' and created_lead.type != 'opportunity':
                updates['type'] = 'opportunity'
            if values.get('stage_id') and created_lead.stage_id.id != values['stage_id']:
                updates['stage_id'] = values['stage_id']
            if updates:
                try:
                    created_lead.write(updates)
                except Exception as e:
                    _logger.exception("Error updating created lead: %s", e)

        default_redirect = '/my/leads' if req_type == 'opportunity' else '/my/leads?type=lead&view=kanban'
        return request.redirect(
            post.get('redirect') or default_redirect
        )

    # =========================================================
    # GENERATE LEADS
    # =========================================================

    @http.route(
        '/my/leads/generate',
        type='http',
        auth='user',
        website=True,
        methods=['POST']
    )
    def portal_generate_leads(
            self,
            **post
    ):

        Lead = request.env[
            'crm.lead'
        ].sudo()

        Partner = request.env[
            'res.partner'
        ].sudo()

        # -----------------------------------------------------
        # NUMBER OF LEADS
        # -----------------------------------------------------

        try:

            lead_count = int(
                post.get(
                    'lead_count',
                    1
                )
            )

        except (
                ValueError,
                TypeError
        ):

            lead_count = 1

        lead_count = max(
            1,
            min(
                lead_count,
                100
            )
        )

        # -----------------------------------------------------
        # VALUES
        # -----------------------------------------------------

        country_id = post.get(
            'country_id'
        )

        state_name = post.get(
            'state_name',
            ''
        ).strip()

        industry_name = post.get(
            'industry',
            ''
        ).strip()

        sales_team_id = post.get(
            'sales_team_id'
        )

        salesperson_id = post.get(
            'salesperson_id'
        )

        tag_ids = request.httprequest.form.getlist(
            'tag_ids'
        )

        # -----------------------------------------------------
        # SALESPERSON
        # -----------------------------------------------------

        user_id = request.env.user.id

        try:

            if salesperson_id:

                salesperson = request.env[
                    'res.users'
                ].sudo().browse(
                    int(salesperson_id)
                )

                if salesperson.exists():
                    user_id = salesperson.id

        except (
                ValueError,
                TypeError
        ):

            pass

        # -----------------------------------------------------
        # SALES TEAM
        # -----------------------------------------------------

        team_id = False

        try:

            if sales_team_id:

                team = request.env[
                    'crm.team'
                ].sudo().browse(
                    int(sales_team_id)
                )

                if team.exists():
                    team_id = team.id

        except (
                ValueError,
                TypeError
        ):

            pass

        # -----------------------------------------------------
        # COUNTRY
        # -----------------------------------------------------

        country = False

        try:

            if country_id:

                country = request.env[
                    'res.country'
                ].sudo().browse(
                    int(country_id)
                )

                if not country.exists():
                    country = False

        except (
                ValueError,
                TypeError
        ):

            country = False

        # -----------------------------------------------------
        # INDUSTRY
        # -----------------------------------------------------

        industry = False

        if industry_name:
            industry = request.env[
                'res.partner.industry'
            ].sudo().search(
                [
                    (
                        'name',
                        'ilike',
                        industry_name
                    )
                ],
                limit=1
            )

        # -----------------------------------------------------
        # STATE
        # -----------------------------------------------------

        state = False

        if state_name:
            state = request.env[
                'res.country.state'
            ].sudo().search(
                [
                    (
                        'name',
                        'ilike',
                        state_name
                    )
                ],
                limit=1
            )

        # -----------------------------------------------------
        # TAGS
        # -----------------------------------------------------

        converted_tag_ids = []

        for tag_id in tag_ids:

            try:

                tag = request.env[
                    'crm.tag'
                ].sudo().browse(
                    int(tag_id)
                )

                if tag.exists():
                    converted_tag_ids.append(
                        tag.id
                    )

            except (
                    ValueError,
                    TypeError
            ):

                continue

        # -----------------------------------------------------
        # CREATE
        # -----------------------------------------------------

        for index in range(
                lead_count
        ):

            lead_name = (
                    'Generated Lead %s'
                    % (index + 1)
            )

            partner_values = {
                'name': lead_name,
            }

            if country:
                partner_values[
                    'country_id'
                ] = country.id

            if state:
                partner_values[
                    'state_id'
                ] = state.id

            if industry:
                partner_values[
                    'industry_id'
                ] = industry.id

            partner = Partner.create(
                partner_values
            )

            lead_values = {

                'name':
                    lead_name,

                'partner_id':
                    partner.id,

                'user_id':
                    user_id,
            }

            if team_id:
                lead_values[
                    'team_id'
                ] = team_id

            if converted_tag_ids:
                lead_values[
                    'tag_ids'
                ] = [
                    (
                        6,
                        0,
                        converted_tag_ids
                    )
                ]

            Lead.create(
                lead_values
            )

        return request.redirect(
            '/my/leads'
        )

    # =========================================================
    # MOVE LEAD
    # =========================================================

    @http.route(
        '/my/leads/<int:lead_id>/stage',
        type='http',
        auth='user',
        website=True,
        methods=['POST']
    )
    def portal_move_lead_stage(
            self,
            lead_id,
            stage_id,
            **kwargs
    ):

        Lead = request.env[
            'crm.lead'
        ].sudo()

        Stage = request.env[
            'crm.stage'
        ].sudo()

        lead = Lead.browse(
            lead_id
        )

        if not self._check_lead_access(
                lead
        ):
            return request.not_found()

        try:

            stage_id = int(
                stage_id
            )

        except (
                ValueError,
                TypeError
        ):

            return request.redirect(
                '/my/leads'
            )

        stage = Stage.browse(
            stage_id
        )

        if not stage.exists():
            return request.redirect(
                '/my/leads'
            )

        lead.sudo().write({
            'stage_id': stage.id,
        })

        if stage.is_won:
            lead.sudo().action_set_won()
            if hasattr(lead, '_update_partner_on_won'):
                lead.sudo()._update_partner_on_won()
            return request.redirect('/my/leads?won=1')

        if lead.type == 'lead':
            return request.redirect(
                '/my/leads?type=lead&view=kanban'
            )

        return request.redirect(
            '/my/leads'
        )

    # =========================================================
    # NEW LEAD / OPPORTUNITY FORM VIEW
    # =========================================================

    @http.route(
        [
            '/my/opportunity/new',
            '/my/leads/new',
        ],
        type='http',
        auth='user',
        website=True,
        methods=['GET', 'POST']
    )
    def portal_lead_new(
            self,
            **post
    ):
        user = request.env.user

        Lead = request.env['crm.lead'].sudo()
        Stage = request.env['crm.stage'].sudo()
        Team = request.env['crm.team'].sudo()
        Tag = request.env['crm.tag'].sudo()
        User = request.env['res.users'].sudo()
        Country = request.env['res.country'].sudo()
        State = request.env['res.country.state'].sudo()
        Partner = request.env['res.partner'].sudo()
        Campaign = request.env['utm.campaign'].sudo() if 'utm.campaign' in request.env else False
        Medium = request.env['utm.medium'].sudo() if 'utm.medium' in request.env else False
        Source = request.env['utm.source'].sudo() if 'utm.source' in request.env else False
        LostReason = request.env['crm.lost.reason'].sudo()

        is_opp_route = 'opportunity' in request.httprequest.path
        req_type = 'opportunity' if is_opp_route else (post.get('type') or request.httprequest.args.get('type') or 'opportunity')

        # -----------------------------------------------------
        # POST: CREATE RECORD
        # -----------------------------------------------------
        if request.httprequest.method == 'POST':
            name = post.get('name', '').strip()
            expected_revenue = post.get('expected_revenue', '0').strip()
            probability = post.get('probability', '0').strip()
            date_deadline = post.get('date_deadline', '').strip()
            contact_name = post.get('contact_name', '').strip()
            email_from = post.get('email_from', '').strip()
            phone = post.get('phone', '').strip()
            website = post.get('website', '').strip()
            function = post.get('function', '').strip()
            email_cc = post.get('email_cc', '').strip()
            priority = post.get('priority', '').strip()
            state_id = post.get('state_id', '').strip()
            partner_id = post.get('partner_id', '').strip()
            description_raw = post.get('description', '').strip()
            description = plaintext2html(description_raw) if description_raw else False

            company_name = (
                post.get('company_name')
                or post.get('partner_name')
                or ''
            ).strip()

            street = post.get('street', '').strip()
            street2 = post.get('street2', '').strip()
            city = post.get('city', '').strip()
            zip_code = post.get('zip', '').strip()
            country_id = post.get('country_id', '').strip()

            salesperson_id = (
                post.get('salesperson_id')
                or post.get('user_id')
                or ''
            ).strip()

            sales_team_id = (
                post.get('sales_team_id')
                or post.get('team_id')
                or ''
            ).strip()

            stage_id = post.get('stage_id', '').strip()
            tag_ids = request.httprequest.form.getlist('tag_ids')

            # Revenue
            try:
                expected_revenue = float(expected_revenue or 0)
            except (ValueError, TypeError):
                expected_revenue = 0.0

            # Probability
            try:
                probability = float(probability or 0)
            except (ValueError, TypeError):
                probability = 0.0
            probability = max(0.0, min(100.0, probability))

            # Salesperson
            user_id = user.id
            if salesperson_id:
                try:
                    salesperson = User.browse(int(salesperson_id))
                    if salesperson.exists():
                        user_id = salesperson.id
                except (ValueError, TypeError):
                    pass

            # Sales Team
            team_id = False
            if sales_team_id:
                try:
                    team = Team.browse(int(sales_team_id))
                    if team.exists():
                        team_id = team.id
                except (ValueError, TypeError):
                    pass

            # Stage
            new_stage_id = False
            first_stage = Stage.search([], order='sequence, id', limit=1)
            if stage_id:
                try:
                    stage = Stage.browse(int(stage_id))
                    if stage.exists():
                        new_stage_id = stage.id
                except (ValueError, TypeError):
                    pass
            if not new_stage_id and req_type == 'opportunity' and first_stage:
                new_stage_id = first_stage.id

            # Country
            new_country_id = False
            if country_id:
                try:
                    country = Country.browse(int(country_id))
                    if country.exists():
                        new_country_id = country.id
                except (ValueError, TypeError):
                    pass

            # Tags
            converted_tag_ids = []
            for tid in tag_ids:
                try:
                    tag = Tag.browse(int(tid))
                    if tag.exists():
                        converted_tag_ids.append(tag.id)
                except (ValueError, TypeError):
                    continue

            # Partner resolution
            lead_partner = False
            company_partner = False
            contact_partner = False
            if partner_id:
                try:
                    p = Partner.browse(int(partner_id))
                    if p.exists():
                        lead_partner = p
                except (ValueError, TypeError):
                    pass

            if not lead_partner and req_type != 'lead':
                if company_name:
                    company_partner = Partner.search([
                        ('name', '=ilike', company_name),
                        ('is_company', '=', True)
                    ], limit=1)
                    if not company_partner:
                        company_partner = Partner.create({
                            'name': company_name,
                            'is_company': True,
                            'street': street,
                            'city': city,
                            'zip': zip_code,
                            'country_id': new_country_id or False,
                        })
                    lead_partner = company_partner
                if contact_name:
                    contact_domain = [
                        ('name', '=ilike', contact_name),
                        ('is_company', '=', False)
                    ]
                    if company_partner:
                        contact_domain.append(('parent_id', '=', company_partner.id))
                    contact_partner = Partner.search(contact_domain, limit=1)
                    if not contact_partner and company_partner:
                        contact_partner = Partner.create({
                            'name': contact_name,
                            'is_company': False,
                            'parent_id': company_partner.id,
                            'email': email_from or False,
                            'phone': phone or False,
                        })
                    if contact_partner:
                        lead_partner = contact_partner

            lead_vals = {
                'name': name or ('New Opportunity' if req_type == 'opportunity' else 'New Lead'),
                'type': req_type,
                'email_from': email_from or False,
                'phone': phone or False,
                'description': description,
                'user_id': user_id,
                'team_id': team_id,
                'expected_revenue': expected_revenue,
                'probability': probability,
                'date_deadline': date_deadline or False,
                'stage_id': new_stage_id or False,
                'priority': priority if priority in ('0', '1', '2', '3') else '0',
                'website': website or False,
                'function': function or False,
                'email_cc': email_cc or False,
                'street': street or False,
                'street2': street2 or False,
                'city': city or False,
                'zip': zip_code or False,
                'country_id': new_country_id or False,
                'contact_name': contact_name or False,
                'partner_name': company_name or False,
                'partner_id': lead_partner.id if lead_partner else False,
                'tag_ids': [(6, 0, converted_tag_ids)],
            }

            if state_id:
                try:
                    lead_vals['state_id'] = int(state_id)
                except (ValueError, TypeError):
                    pass

            if post.get('campaign_id'):
                try:
                    lead_vals['campaign_id'] = int(post['campaign_id'])
                except (ValueError, TypeError):
                    pass

            if post.get('medium_id'):
                try:
                    lead_vals['medium_id'] = int(post['medium_id'])
                except (ValueError, TypeError):
                    pass

            if post.get('source_id'):
                try:
                    lead_vals['source_id'] = int(post['source_id'])
                except (ValueError, TypeError):
                    pass

            if post.get('referred'):
                lead_vals['referred'] = post.get('referred', '').strip() or False

            try:
                new_lead = Lead.create(lead_vals)
                if post.get('crm_action') == 'save_and_close':
                    return request.redirect(
                        '/my/leads?type=lead&view=kanban' if req_type == 'lead' else '/my/leads'
                    )
                return request.redirect('/my/leads/%s?saved=1' % new_lead.id)
            except Exception as e:
                _logger.exception("Error creating lead from form: %s", e)
                return request.redirect('/my/leads?error=1')

        # -----------------------------------------------------
        # GET: RENDER FORM VIEW
        # -----------------------------------------------------
        stages = Stage.search([], order='sequence, id')
        first_stage = stages[0] if stages else False

        lead = Lead.new({
            'name': '',
            'type': req_type,
            'user_id': user.id,
            'stage_id': first_stage.id if first_stage else False,
            'priority': '0',
            'expected_revenue': 0.0,
            'probability': 0.0,
            'active': True,
            'company_currency': request.env.company.currency_id,
        })

        teams = Team.search([], order='name')
        tags = Tag.search([], order='name')
        users = User.search([('active', '=', True)], order='name')
        countries = Country.search([], order='name')
        states = State.search([], order='name')
        lost_reasons = LostReason.search([], order='name')
        campaigns = Campaign.search([], order='name') if Campaign else []
        mediums = Medium.search([], order='name') if Medium else []
        sources = Source.search([], order='name') if Source else []
        partners = Partner.search([('active', '=', True)], order='name', limit=200)
        company_partners = Partner.search([('is_company', '=', True), ('active', '=', True)], order='name', limit=200)
        companies = request.env['res.company'].sudo().search([])
        available_opportunities = Lead.search([('type', '=', 'opportunity')], order='create_date desc, id desc', limit=100)

        return request.render(
            'crm_portal.portal_lead_detail',
            {
                'lead': lead,
                'lead_description': '',
                'stages': stages,
                'teams': teams,
                'tags': tags,
                'users': users,
                'countries': countries,
                'states': states,
                'partners': partners,
                'company_partners': company_partners,
                'campaigns': campaigns,
                'mediums': mediums,
                'sources': sources,
                'lost_reasons': lost_reasons,
                'companies': companies,
                'available_opportunities': available_opportunities,
            }
        )

    # =========================================================
    # LEAD DETAIL / EDIT
    # =========================================================

    @http.route(
        '/my/leads/<int:lead_id>',
        type='http',
        auth='user',
        website=True,
        methods=['GET', 'POST']
    )
    def portal_lead_detail(
            self,
            lead_id,
            **post
    ):

        Lead = request.env[
            'crm.lead'
        ].sudo()

        Stage = request.env[
            'crm.stage'
        ].sudo()

        Team = request.env[
            'crm.team'
        ].sudo()

        Tag = request.env[
            'crm.tag'
        ].sudo()

        User = request.env[
            'res.users'
        ].sudo()

        Country = request.env[
            'res.country'
        ].sudo()

        lead = Lead.browse(
            lead_id
        )

        # -----------------------------------------------------
        # SECURITY
        # -----------------------------------------------------

        if not self._check_lead_access(
                lead
        ):
            return request.not_found()

        # =====================================================
        # WON / LOST ACTIONS
        # =====================================================

        # =====================================================
        # HANDLE WON / LOST ACTIONS
        # =====================================================

        if request.httprequest.method == 'POST':

            crm_action = post.get('crm_action')

            # -------------------------------------------------
            # MARK AS WON
            # -------------------------------------------------
            if crm_action == 'won':

                if not lead.active:
                    return request.redirect(
                        '/my/leads/%s' % lead.id
                    )

                # Capture any edited contact / company info from the form
                pre_won_vals = {}
                company_name = (post.get('company_name') or post.get('partner_name') or '').strip()
                contact_name = post.get('contact_name', '').strip()
                if company_name:
                    pre_won_vals['partner_name'] = company_name
                if contact_name:
                    pre_won_vals['contact_name'] = contact_name
                if post.get('email_from'):
                    pre_won_vals['email_from'] = post.get('email_from', '').strip()
                if post.get('phone'):
                    pre_won_vals['phone'] = post.get('phone', '').strip()
                if post.get('website'):
                    pre_won_vals['website'] = post.get('website', '').strip()
                if post.get('street'):
                    pre_won_vals['street'] = post.get('street', '').strip()
                if post.get('street2'):
                    pre_won_vals['street2'] = post.get('street2', '').strip()
                if post.get('city'):
                    pre_won_vals['city'] = post.get('city', '').strip()
                if post.get('zip'):
                    pre_won_vals['zip'] = post.get('zip', '').strip()
                if post.get('country_id'):
                    try:
                        pre_won_vals['country_id'] = int(post['country_id'])
                    except (ValueError, TypeError):
                        pass
                if pre_won_vals:
                    lead.sudo().write(pre_won_vals)

                # Execute Odoo's standard CRM Won workflow using sudo
                lead.sudo().action_set_won()

                # Ensure won partner check executed
                if hasattr(lead, '_update_partner_on_won'):
                    lead.sudo()._update_partner_on_won()

                return request.redirect(
                    '/my/leads?won=1'
                )

            # -------------------------------------------------
            # MARK AS LOST
            # -------------------------------------------------
            elif crm_action == 'lost':

                if not lead.active:
                    return request.redirect(
                        '/my/leads/%s' % lead.id
                    )

                # Get the selected lost reason.
                try:
                    lost_reason_id = int(
                        post.get('lost_reason_id') or 0
                    )
                except (ValueError, TypeError):
                    lost_reason_id = 0

                lost_reason = request.env[
                    'crm.lost.reason'
                ].sudo().browse(
                    lost_reason_id
                ).exists()

                # A valid lost reason is required.
                if not lost_reason:
                    return request.redirect(
                        '/my/leads/%s' % lead.id
                    )

                # Get the closing note.
                lost_feedback = post.get(
                    'lost_feedback',
                    ''
                ).strip()

                # Create Odoo's standard Lost wizard.
                wizard = request.env[
                    'crm.lead.lost'
                ].sudo().with_context(
                    active_model='crm.lead',
                    active_ids=[lead.id],
                ).create({
                    'lost_reason_id': lost_reason.id,
                    'lost_feedback': lost_feedback,
                })

                # Execute Odoo's standard Lost workflow.
                wizard.action_lost_reason_apply()

                # Ensure the lead is archived and its Lost Reason is saved.
                lead.sudo().write({
                    'active': False,
                    'lost_reason_id': lost_reason.id,
                    'probability': 0,
                })

                if lead.type == 'lead':
                    return request.redirect('/my/leads?stage=lost_leads')
                else:
                    return request.redirect('/my/leads?stage=lost')

        # =====================================================
        # SAVE
        # =====================================================

        if request.httprequest.method == 'POST':

            name = post.get(
                'name',
                ''
            ).strip()

            expected_revenue = post.get(
                'expected_revenue',
                '0'
            ).strip()

            probability = post.get(
                'probability',
                '0'
            ).strip()

            date_deadline = post.get(
                'date_deadline',
                ''
            ).strip()

            contact_name = post.get(
                'contact_name',
                ''
            ).strip()

            email_from = post.get(
                'email_from',
                ''
            ).strip()

            phone = post.get(
                'phone',
                ''
            ).strip()

            website = post.get(
                'website',
                ''
            ).strip()

            function = post.get(
                'function',
                ''
            ).strip()

            email_cc = post.get(
                'email_cc',
                ''
            ).strip()

            priority = post.get(
                'priority',
                ''
            ).strip()

            state_id = post.get(
                'state_id',
                ''
            ).strip()

            partner_id = post.get(
                'partner_id',
                ''
            ).strip()

            description_raw = post.get(
                'description',
                ''
            ).strip()

            description = plaintext2html(description_raw) if description_raw else False

            company_name = (
                post.get('company_name')
                or post.get('partner_name')
                or ''
            ).strip()

            street = post.get(
                'street',
                ''
            ).strip()

            street2 = post.get(
                'street2',
                ''
            ).strip()

            city = post.get(
                'city',
                ''
            ).strip()

            zip_code = post.get(
                'zip',
                ''
            ).strip()

            country_id = post.get(
                'country_id',
                ''
            ).strip()

            salesperson_id = (
                post.get('salesperson_id')
                or post.get('user_id')
                or ''
            ).strip()

            sales_team_id = (
                post.get('sales_team_id')
                or post.get('team_id')
                or ''
            ).strip()

            stage_id = post.get(
                'stage_id',
                ''
            ).strip()

            tag_ids = request.httprequest.form.getlist(
                'tag_ids'
            )

            # -------------------------------------------------
            # REVENUE
            # -------------------------------------------------

            try:

                expected_revenue = float(
                    expected_revenue or 0
                )

            except (
                    ValueError,
                    TypeError
            ):

                expected_revenue = 0.0

            # -------------------------------------------------
            # PROBABILITY
            # -------------------------------------------------

            try:

                probability = float(
                    probability or 0
                )

            except (
                    ValueError,
                    TypeError
            ):

                probability = 0.0

            probability = max(
                0.0,
                min(
                    100.0,
                    probability
                )
            )

            # -------------------------------------------------
            # SALESPERSON
            # -------------------------------------------------

            if salesperson_id:
                try:
                    salesperson = User.browse(
                        int(salesperson_id)
                    )
                    if salesperson.exists():
                        user_id = salesperson.id
                except (
                        ValueError,
                        TypeError
                ):
                    user_id = lead.user_id.id or request.env.user.id
            else:
                user_id = lead.user_id.id or request.env.user.id

            # -------------------------------------------------
            # TEAM
            # -------------------------------------------------

            team_id = False

            try:

                if sales_team_id:

                    team = Team.browse(
                        int(sales_team_id)
                    )

                    if team.exists():
                        team_id = team.id

            except (
                    ValueError,
                    TypeError
            ):

                team_id = False

            # -------------------------------------------------
            # STAGE
            # -------------------------------------------------

            new_stage_id = False

            try:

                if stage_id:

                    stage = Stage.browse(
                        int(stage_id)
                    )

                    if stage.exists():
                        new_stage_id = stage.id

            except (
                    ValueError,
                    TypeError
            ):

                new_stage_id = False

            # -------------------------------------------------
            # COUNTRY
            # -------------------------------------------------

            new_country_id = False

            try:

                if country_id:

                    country = Country.browse(
                        int(country_id)
                    )

                    if country.exists():
                        new_country_id = country.id

            except (
                    ValueError,
                    TypeError
            ):

                new_country_id = False

            # -------------------------------------------------
            # TAGS
            # -------------------------------------------------

            converted_tag_ids = []

            for tag_id in tag_ids:

                try:

                    tag = Tag.browse(
                        int(tag_id)
                    )

                    if tag.exists():
                        converted_tag_ids.append(
                            tag.id
                        )

                except (
                        ValueError,
                        TypeError
                ):

                    continue

            # -------------------------------------------------
            # PARTNER & COMPANY
            # -------------------------------------------------

            Partner = request.env['res.partner'].sudo()
            lead_partner = lead.partner_id
            company_partner = False

            if lead_partner:
                if lead_partner.is_company:
                    company_partner = lead_partner
                    if company_name:
                        company_partner.write({
                            'name': company_name,
                            'street': street,
                            'city': city,
                            'zip': zip_code,
                            'country_id': new_country_id or False,
                        })
                else:
                    if lead_partner.parent_id:
                        company_partner = lead_partner.parent_id
                        if company_name:
                            company_partner.write({
                                'name': company_name,
                                'street': street,
                                'city': city,
                                'zip': zip_code,
                                'country_id': new_country_id or False,
                            })
                    elif company_name:
                        company_partner = Partner.search([
                            ('name', '=ilike', company_name),
                            ('is_company', '=', True)
                        ], limit=1)
                        if not company_partner:
                            company_partner = Partner.create({
                                'name': company_name,
                                'is_company': True,
                                'street': street,
                                'city': city,
                                'zip': zip_code,
                                'country_id': new_country_id or False,
                            })
                        lead_partner.write({'parent_id': company_partner.id})

                    if not company_partner and (street or city or zip_code or new_country_id):
                        lead_partner.write({
                            'street': street,
                            'city': city,
                            'zip': zip_code,
                            'country_id': new_country_id or False,
                        })
            else:
                if (lead.type != 'lead' or (lead.stage_id and lead.stage_id.is_won) or probability == 100) and company_name:
                    company_partner = Partner.search([
                        ('name', '=ilike', company_name),
                        ('is_company', '=', True)
                    ], limit=1)
                    if not company_partner:
                        company_partner = Partner.create({
                            'name': company_name,
                            'is_company': True,
                            'street': street,
                            'city': city,
                            'zip': zip_code,
                            'country_id': new_country_id or False,
                        })
                    lead_partner = company_partner

            # -------------------------------------------------
            # LEAD
            # -------------------------------------------------

            lead_vals = {
                'name':
                    name or lead.name,

                'email_from':
                    email_from,

                'phone':
                    phone,

                'description':
                    description,

                'user_id':
                    user_id,

                'team_id':
                    team_id,

                'tag_ids':
                    [
                        (
                            6,
                            0,
                            converted_tag_ids
                        )
                    ],
            }

            if 'contact_name' in post:
                lead_vals['contact_name'] = contact_name or False
            elif lead.contact_name:
                lead_vals['contact_name'] = lead.contact_name

            if 'company_name' in post or 'partner_name' in post:
                lead_vals['partner_name'] = company_name or False
            elif lead.partner_name:
                lead_vals['partner_name'] = lead.partner_name

            if 'expected_revenue' in post:
                lead_vals['expected_revenue'] = expected_revenue
            if 'probability' in post:
                lead_vals['probability'] = probability
            if 'date_deadline' in post:
                lead_vals['date_deadline'] = date_deadline or False
            if 'stage_id' in post:
                lead_vals['stage_id'] = new_stage_id or lead.stage_id.id
            if priority in ('0', '1', '2', '3'):
                lead_vals['priority'] = priority

            if 'website' in post:
                lead_vals['website'] = website or False
            if 'function' in post:
                lead_vals['function'] = function or False
            if 'email_cc' in post:
                lead_vals['email_cc'] = email_cc or False
            if 'street' in post:
                lead_vals['street'] = street or False
            if 'street2' in post:
                lead_vals['street2'] = street2 or False
            if 'city' in post:
                lead_vals['city'] = city or False
            if 'zip' in post:
                lead_vals['zip'] = zip_code or False
            if 'country_id' in post:
                lead_vals['country_id'] = new_country_id or False
            if state_id:
                try:
                    lead_vals['state_id'] = int(state_id)
                except (ValueError, TypeError):
                    pass
            elif 'state_id' in post:
                lead_vals['state_id'] = False

            is_won_target = bool(
                (new_stage_id and Stage.browse(new_stage_id).is_won)
                or (lead.stage_id and lead.stage_id.is_won and not new_stage_id)
                or probability == 100
            )

            if is_won_target:
                lead.with_context(skip_won_partner_check=True).write(lead_vals)
                if hasattr(lead, '_update_partner_on_won'):
                    lead._update_partner_on_won()
            elif partner_id:
                try:
                    lead_vals['partner_id'] = int(partner_id)
                except (ValueError, TypeError):
                    pass
                lead.write(lead_vals)
            elif 'partner_id' in post and not partner_id:
                lead_vals['partner_id'] = False
                lead.write(lead_vals)
            elif lead_partner and (lead.type != 'lead' or is_won_target):
                lead_vals['partner_id'] = lead_partner.id
                lead.write(lead_vals)
            elif lead.type == 'lead' and not is_won_target:
                lead_vals['partner_id'] = False
                lead.write(lead_vals)
            else:
                lead.write(lead_vals)

            if 'type' in post and post.get('type') in ('lead', 'opportunity'):
                lead_vals['type'] = post.get('type')
            if 'campaign_id' in post:
                try:
                    lead_vals['campaign_id'] = int(post['campaign_id']) if post['campaign_id'] else False
                except (ValueError, TypeError):
                    pass
            if 'medium_id' in post:
                try:
                    lead_vals['medium_id'] = int(post['medium_id']) if post['medium_id'] else False
                except (ValueError, TypeError):
                    pass
            if 'source_id' in post:
                try:
                    lead_vals['source_id'] = int(post['source_id']) if post['source_id'] else False
                except (ValueError, TypeError):
                    pass
            if 'referred' in post:
                lead_vals['referred'] = post.get('referred', '').strip() or False
            if 'company_id' in post:
                try:
                    lead_vals['company_id'] = int(post['company_id']) if post['company_id'] else False
                except (ValueError, TypeError):
                    pass
            if 'mobile' in post:
                mobile_val = post.get('mobile', '').strip() or False
                if 'mobile' in lead._fields:
                    lead_vals['mobile'] = mobile_val
                elif lead.partner_id and 'mobile' in lead.partner_id._fields:
                    lead.partner_id.write({'mobile': mobile_val})

            try:
                lead.write(lead_vals)
                if is_won_target and hasattr(lead, '_update_partner_on_won'):
                    lead._update_partner_on_won()
                if post.get('crm_action') == 'save_and_close':
                    return request.redirect(
                        '/my/leads?type=lead&view=kanban' if lead.type == 'lead' else '/my/leads'
                    )
                return request.redirect(
                    '/my/leads/%s?saved=1'
                    % lead.id
                )
            except Exception:
                return request.redirect(
                    '/my/leads/%s?error=1'
                    % lead.id
                )

        # =====================================================
        # FORM DATA
        # =====================================================

        stages = Stage.search(
            [],
            order='sequence, id'
        )

        teams = Team.search(
            [],
            order='name'
        )

        tags = Tag.search(
            [],
            order='name'
        )

        users = User.search([('active', '=', True)], order='name')

        countries = Country.search(
            [],
            order='name'
        )

        State = request.env['res.country.state'].sudo()
        states = State.search(
            [],
            order='name'
        )

        Partner = request.env['res.partner'].sudo()
        partners = Partner.search(
            [('active', '=', True)],
            order='name',
            limit=200
        )
        if lead.partner_id and lead.partner_id not in partners:
            partners = (lead.partner_id | partners)

        # =====================================================
        # LOST REASONS
        # =====================================================

        LostReason = request.env['crm.lost.reason'].sudo()

        lost_reasons = LostReason.search(
            [],
            order='name'
        )

        Campaign = request.env['utm.campaign'].sudo()
        campaigns = Campaign.search([], order='name')

        Medium = request.env['utm.medium'].sudo()
        mediums = Medium.search([], order='name')

        Source = request.env['utm.source'].sudo()
        sources = Source.search([], order='name')

        Company = request.env['res.company'].sudo()
        companies = Company.search([], order='name')

        # =====================================================
        # RENDER
        # =====================================================

        lead_description = html2plaintext(lead.description).strip() if lead.description else ''

        company_partners = Partner.search([
            ('is_company', '=', True),
            ('active', '=', True)
        ], order='name', limit=200)

        avail_opp_domain = [('type', '=', 'opportunity'), ('id', '!=', lead.id)]
        if request.env.user.share:
            avail_opp_domain.append(('user_id', '=', request.env.user.id))
        available_opportunities = Lead.search(avail_opp_domain, order='create_date desc, id desc', limit=100)

        return request.render(
            'crm_portal.portal_lead_detail',
            {
                'lead': lead,
                'lead_description': lead_description,
                'stages': stages,
                'teams': teams,
                'tags': tags,
                'users': users,
                'countries': countries,
                'states': states,
                'partners': partners,
                'company_partners': company_partners,
                'campaigns': campaigns,
                'mediums': mediums,
                'sources': sources,
                'lost_reasons': lost_reasons,
                'companies': companies,
                'available_opportunities': available_opportunities,
            }
        )

    # =========================================================
    # LEADS LIST (DEDICATED WEBSITE VIEW)
    # =========================================================

    @http.route(
        '/my/crm-leads',
        type='http',
        auth='user',
        website=True
    )
    def portal_my_crm_leads(self, **kwargs):
        Lead = request.env['crm.lead'].sudo()
        user = request.env.user

        lead_domain = [('type', '=', 'lead')]
        if not user.has_group('base.group_system'):
            lead_domain.append(('user_id', '=', user.id))

        leads = Lead.search(
            lead_domain,
            order='create_date desc, id desc'
        )

        avail_opp_domain = [('type', '=', 'opportunity')]
        if user.share:
            avail_opp_domain.append(('user_id', '=', user.id))
        available_opportunities = Lead.search(avail_opp_domain, order='create_date desc, id desc', limit=100)

        Partner = request.env['res.partner'].sudo()
        partners = Partner.search([('active', '=', True)], order='name', limit=200)
        company_partners = Partner.search([('is_company', '=', True), ('active', '=', True)], order='name', limit=200)

        return request.render(
            'crm_portal.portal_leads_list',
            {
                'leads': leads,
                'total_leads_count': len(leads),
                'users': request.env['res.users'].sudo().search([('active', '=', True)], order='name'),
                'teams': request.env['crm.team'].sudo().search([]),
                'tags': request.env['crm.tag'].sudo().search([]),
                'countries': request.env['res.country'].sudo().search([], order='name'),
                'states': request.env['res.country.state'].sudo().search([], order='name'),
                'partners': partners,
                'company_partners': company_partners,
                'available_opportunities': available_opportunities,
            }
        )

    # =========================================================
    # QUICK CREATE LEAD FROM LEADS LIST
    # =========================================================

    @http.route(
        '/my/crm-leads/quick-create',
        type='http',
        auth='user',
        website=True,
        methods=['POST']
    )
    def portal_quick_create_crm_lead(self, **post):
        if not post.get('redirect') or post.get('redirect') == '/my/crm-leads':
            post['redirect'] = '/my/leads?type=lead&view=kanban'
        if not post.get('type'):
            post['type'] = 'lead'
        return self.portal_quick_create_lead(**post)

    # =========================================================
    # CONVERT LEADS TO OPPORTUNITIES
    # =========================================================

    @http.route(
        '/my/crm-leads/convert',
        type='http',
        auth='user',
        website=True,
        methods=['POST']
    )
    def portal_convert_crm_leads(self, **post):
        Lead = request.env['crm.lead'].sudo()
        Stage = request.env['crm.stage'].sudo()

        first_stage = Stage.search([], order='sequence, id', limit=1)

        lead_ids_raw = request.httprequest.form.getlist('lead_ids')
        if not lead_ids_raw and post.get('lead_id'):
            lead_ids_raw = [post.get('lead_id')]

        lead_ids = []
        for item in lead_ids_raw:
            for sub in str(item).split(','):
                sub = sub.strip()
                if sub.isdigit():
                    lead_ids.append(int(sub))

        conversion_action = post.get('conversion_action') or 'convert'
        customer_action = post.get('customer_action') or 'create'
        user = request.env.user
        user_id = post.get('user_id') or post.get('salesperson_id')
        user_id_int = int(user_id) if user_id and str(user_id).isdigit() else (user.id if user.share else False)

        team_id = post.get('team_id')
        team_id_int = int(team_id) if team_id and str(team_id).isdigit() else False
        company_partner_id_raw = post.get('company_partner_id')
        company_partner_id_int = False
        company_name_from_select = False
        if company_partner_id_raw:
            str_cp = str(company_partner_id_raw).strip()
            if str_cp.isdigit():
                company_partner_id_int = int(str_cp)
            elif str_cp.startswith('new:'):
                company_name_from_select = str_cp.split('new:', 1)[1].strip()

        partner_id = post.get('partner_id')
        partner_id_int = int(partner_id) if partner_id and str(partner_id).isdigit() else False

        # Gather any opportunity IDs to merge with
        merge_opp_ids = [int(i) for i in request.httprequest.form.getlist('opportunity_ids') if str(i).isdigit()]
        if post.get('opportunity_id') and str(post.get('opportunity_id')).isdigit():
            merge_opp_ids.append(int(post.get('opportunity_id')))

        converted_lead_id = False
        if lead_ids:
            leads_to_convert = Lead.browse(lead_ids)

            if conversion_action == 'merge':
                # Standard Odoo CRM Merge Operation
                for lead in leads_to_convert:
                    if self._check_lead_access(lead):
                        all_to_merge_ids = list(dict.fromkeys([lead.id] + merge_opp_ids))
                        records_to_merge = Lead.browse(all_to_merge_ids).exists()
                        if len(records_to_merge) > 1:
                            try:
                                result_opp = records_to_merge.sudo().merge_opportunity(
                                    user_id=user_id_int or (lead.user_id.id if lead.user_id else user.id),
                                    team_id=team_id_int or (lead.team_id.id if lead.team_id else False),
                                    auto_unlink=True
                                )
                                result_opp.sudo().action_unarchive()
                                if result_opp.type != 'opportunity':
                                    result_opp.sudo().write({'type': 'opportunity'})
                                if first_stage and not result_opp.stage_id:
                                    result_opp.sudo().write({'stage_id': first_stage.id})
                                converted_lead_id = result_opp.id
                            except Exception as e:
                                _logger.exception("Error merging opportunities: %s", e)
                                lead.sudo().write({
                                    'type': 'opportunity',
                                    'user_id': user_id_int or lead.user_id.id or user.id,
                                    'team_id': team_id_int or lead.team_id.id,
                                    'stage_id': first_stage.id if (first_stage and not lead.stage_id) else lead.stage_id.id,
                                })
                                converted_lead_id = lead.id
                        else:
                            lead.sudo().write({
                                'type': 'opportunity',
                                'user_id': user_id_int or lead.user_id.id or user.id,
                                'team_id': team_id_int or lead.team_id.id,
                                'stage_id': first_stage.id if (first_stage and not lead.stage_id) else lead.stage_id.id,
                            })
                            converted_lead_id = lead.id
            else:
                # Standard Convert to opportunity (direct with sudo, avoiding backend transient wizard check)
                for lead in leads_to_convert:
                    if self._check_lead_access(lead):
                        converted_lead_id = lead.id

                        resolved_company_name = (
                            post.get('company_name')
                            or company_name_from_select
                            or lead.partner_name
                            or ''
                        ).strip()

                        resolved_contact_name = (
                            post.get('contact_name')
                            or lead.contact_name
                            or ''
                        ).strip()

                        # Capture any company and contact information passed from form before convert
                        pre_vals = {}
                        if resolved_company_name:
                            pre_vals['partner_name'] = resolved_company_name
                        if resolved_contact_name:
                            pre_vals['contact_name'] = resolved_contact_name
                        if post.get('email_from'):
                            pre_vals['email_from'] = post.get('email_from').strip()
                        if post.get('phone'):
                            pre_vals['phone'] = post.get('phone').strip()
                        if pre_vals:
                            lead.sudo().write(pre_vals)

                        saved_partner_name = lead.partner_name or resolved_company_name
                        saved_contact_name = lead.contact_name or resolved_contact_name

                        Partner = request.env['res.partner'].sudo()
                        lead_company_partner_id = company_partner_id_int
                        target_partner = False

                        if customer_action == 'exist' and partner_id_int:
                            target_partner = Partner.browse(partner_id_int)
                        elif customer_action == 'create':
                            if saved_partner_name and not lead_company_partner_id:
                                company_partner = Partner.search([
                                    ('name', '=ilike', saved_partner_name),
                                    ('is_company', '=', True)
                                ], limit=1)
                                if not company_partner:
                                    comp_vals = {
                                        'name': saved_partner_name,
                                        'is_company': True,
                                    }
                                    if lead.street:
                                        comp_vals['street'] = lead.street
                                    if lead.street2:
                                        comp_vals['street2'] = lead.street2
                                    if lead.city:
                                        comp_vals['city'] = lead.city
                                    if lead.zip:
                                        comp_vals['zip'] = lead.zip
                                    if lead.state_id:
                                        comp_vals['state_id'] = lead.state_id.id
                                    if lead.country_id:
                                        comp_vals['country_id'] = lead.country_id.id
                                    if lead.website:
                                        comp_vals['website'] = lead.website
                                    company_partner = Partner.create(comp_vals)
                                lead_company_partner_id = company_partner.id

                            if lead_company_partner_id:
                                if saved_contact_name:
                                    contact_partner = Partner.search([
                                        ('name', '=ilike', saved_contact_name),
                                        ('parent_id', '=', lead_company_partner_id)
                                    ], limit=1)
                                    if not contact_partner:
                                        if lead.partner_id and not lead.partner_id.is_company:
                                            lead.partner_id.sudo().write({
                                                'name': saved_contact_name,
                                                'parent_id': lead_company_partner_id,
                                            })
                                            contact_partner = lead.partner_id
                                        else:
                                            contact_partner = Partner.create({
                                                'name': saved_contact_name,
                                                'is_company': False,
                                                'parent_id': lead_company_partner_id,
                                                'email': lead.email_from or False,
                                                'phone': lead.phone or False,
                                            })
                                    target_partner = contact_partner
                                else:
                                    target_partner = Partner.browse(lead_company_partner_id)
                            elif saved_contact_name:
                                contact_partner = Partner.search([
                                    ('name', '=ilike', saved_contact_name),
                                    ('is_company', '=', False)
                                ], limit=1)
                                if not contact_partner:
                                    contact_partner = Partner.create({
                                        'name': saved_contact_name,
                                        'is_company': False,
                                        'email': lead.email_from or False,
                                        'phone': lead.phone or False,
                                    })
                                target_partner = contact_partner

                        # Direct, safe opportunity conversion using sudo
                        from odoo import fields
                        conv_vals = {
                            'type': 'opportunity',
                            'date_conversion': fields.Datetime.now(),
                        }
                        if first_stage and not lead.stage_id:
                            conv_vals['stage_id'] = first_stage.id
                        if user_id_int:
                            conv_vals['user_id'] = user_id_int
                        elif user.share and not lead.user_id:
                            conv_vals['user_id'] = user.id
                        if team_id_int:
                            conv_vals['team_id'] = team_id_int
                        if target_partner:
                            conv_vals['partner_id'] = target_partner.id
                        elif customer_action == 'exist' and partner_id_int:
                            conv_vals['partner_id'] = partner_id_int
                        elif lead_company_partner_id:
                            conv_vals['partner_id'] = lead_company_partner_id
                        if saved_partner_name:
                            conv_vals['partner_name'] = saved_partner_name
                        if saved_contact_name:
                            conv_vals['contact_name'] = saved_contact_name

                        lead.sudo().write(conv_vals)

                        # If customer created with parent company, ensure parent_id is set
                        if lead_company_partner_id and lead.partner_id and not lead.partner_id.is_company and not lead.partner_id.parent_id:
                            lead.partner_id.sudo().write({'parent_id': lead_company_partner_id})

                        # If customer_action was exist and partner belongs to a company, set partner_name
                        if customer_action == 'exist' and lead.partner_id:
                            parent_comp = lead.partner_id.parent_id or (lead.partner_id if lead.partner_id.is_company else False)
                            if parent_comp and not lead.partner_name:
                                lead.sudo().write({'partner_name': parent_comp.name})

        redirect_url = post.get('redirect')
        if not redirect_url or (converted_lead_id and '/my/leads/' in redirect_url):
            if converted_lead_id:
                redirect_url = '/my/leads/%s?converted=1' % converted_lead_id
            else:
                redirect_url = '/my/leads?converted=1'
        return request.redirect(redirect_url)

    # =========================================================
    # SET LEAD / OPPORTUNITY PRIORITY (AJAX/RPC)
    # =========================================================

    @http.route(
        '/my/leads/<int:lead_id>/priority',
        type='jsonrpc',
        auth='user',
        methods=['POST']
    )
    def portal_set_lead_priority(self, lead_id, priority='0', **kw):
        lead = request.env['crm.lead'].sudo().browse(lead_id)
        if not lead.exists() or not self._check_lead_access(lead):
            return {'status': 'error', 'message': 'Access Denied'}
        str_priority = str(priority)
        if str_priority in ('0', '1', '2', '3'):
            lead.write({'priority': str_priority})
            return {'status': 'success', 'priority': str_priority}
        return {'status': 'error', 'message': 'Invalid priority'}
