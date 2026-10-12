from odoo import http
from odoo.http import request
from odoo.addons.portal.controllers.portal import CustomerPortal
from odoo.addons.website.controllers.main import Website


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

            if user.has_group('base.group_system'):

                values['lead_count'] = Lead.search_count([])

            else:

                values['lead_count'] = Lead.search_count([
                    ('user_id', '=', user.id)
                ])

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

        # User can access only own leads
        return lead.user_id.id == user.id

    # =========================================================
    # GET LEAD DOMAIN
    # =========================================================

    def _get_lead_domain(self):

        user = request.env.user

        if user.has_group('base.group_system'):
            return []

        return [
            ('user_id', '=', user.id)
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
        # LEADS
        # -----------------------------------------------------

        domain = self._get_lead_domain()

        leads = Lead.search(
            domain,
            order='stage_id, priority desc, id desc'
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

            leads_by_stage[stage.id] = leads.filtered(
                lambda lead:
                    lead.stage_id.id == stage.id
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

        users = User.search(
            [],
            order='name'
        )

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

        # -----------------------------------------------------
        # RENDER
        # -----------------------------------------------------

        return request.render(
            'crm_portal.portal_my_leads',
            {
                'leads': leads,
                'stages': stages,
                'leads_by_stage': leads_by_stage,

                'teams': teams,
                'tags': tags,
                'users': users,
                'countries': countries,
                'states': states,
                'industries': industries,
            }
        )

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
        # COMPANY
        # -----------------------------------------------------

        partner = False

        if company_name:

            partner = Partner.search(
                [
                    (
                        'name',
                        '=',
                        company_name
                    )
                ],
                limit=1
            )

            if not partner:

                partner = Partner.create({
                    'name': company_name,
                    'email': email_from or False,
                    'phone': phone or False,
                })

        # -----------------------------------------------------
        # CREATE VALUES
        # -----------------------------------------------------

        values = {

            'name':
                name or 'New Lead',

            'partner_id':
                partner.id if partner else False,

            'contact_name':
                contact_name,

            'email_from':
                email_from,

            'phone':
                phone,

            'expected_revenue':
                expected_revenue,

            # Assign to logged-in user
            'user_id':
                request.env.user.id,
        }

        # -----------------------------------------------------
        # STAGE
        # -----------------------------------------------------

        if stage_id:

            Stage = request.env[
                'crm.stage'
            ].sudo()

            stage = Stage.browse(
                stage_id
            )

            if stage.exists():

                values['stage_id'] = stage.id

        # -----------------------------------------------------
        # CREATE
        # -----------------------------------------------------

        Lead.create(
            values
        )

        return request.redirect(
            '/my/leads'
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

        lead.write({
            'stage_id': stage.id,
        })

        return request.redirect(
            '/my/leads'
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

            description = post.get(
                'description',
                ''
            )

            company_name = post.get(
                'company_name',
                ''
            ).strip()

            street = post.get(
                'street',
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

            salesperson_id = post.get(
                'salesperson_id',
                ''
            ).strip()

            sales_team_id = post.get(
                'sales_team_id',
                ''
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

            user_id = False

            try:

                if salesperson_id:

                    salesperson = User.browse(
                        int(salesperson_id)
                    )

                    if salesperson.exists():

                        user_id = salesperson.id

            except (
                ValueError,
                TypeError
            ):

                user_id = False

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
            # PARTNER
            # -------------------------------------------------

            if lead.partner_id:

                lead.partner_id.sudo().write({

                    'name':
                        company_name,

                    'street':
                        street,

                    'city':
                        city,

                    'zip':
                        zip_code,

                    'country_id':
                        new_country_id or False,
                })

            # -------------------------------------------------
            # LEAD
            # -------------------------------------------------

            lead.write({

                'name':
                    name or lead.name,

                'expected_revenue':
                    expected_revenue,

                'probability':
                    probability,

                'date_deadline':
                    date_deadline or False,

                'contact_name':
                    contact_name,

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

                'stage_id':
                    new_stage_id or lead.stage_id.id,

                'tag_ids':
                    [
                        (
                            6,
                            0,
                            converted_tag_ids
                        )
                    ],
            })

            return request.redirect(
                '/my/leads/%s'
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

        users = User.search(
            [],
            order='name'
        )

        countries = Country.search(
            [],
            order='name'
        )

        # =====================================================
        # RENDER
        # =====================================================

        return request.render(
            'crm_portal.portal_lead_detail',
            {
                'lead': lead,
                'stages': stages,
                'teams': teams,
                'tags': tags,
                'users': users,
                'countries': countries,
            }
        )