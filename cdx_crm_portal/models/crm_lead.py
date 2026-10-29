
# -*- coding: utf-8 -*-

from odoo import api, fields, models


class CrmLead(models.Model):
    _inherit = 'crm.lead'
    _order = 'create_date desc, id desc'

    def _update_partner_on_won(self):
        """
        When an opportunity is marked as Won, check contact and company information
        and ensure both the company name and contact name are displayed in the Contact (partner_id) field.
        """
        Partner = self.env['res.partner'].sudo()
        for lead in self:
            company_name = (lead.partner_name or '').strip()
            contact_name = (lead.contact_name or '').strip()
            lead_name = (lead.name or '').strip()

            # If partner_name is empty, check if partner_id already has a parent company or is a company
            if not company_name and lead.partner_id:
                if lead.partner_id.parent_id:
                    company_name = (lead.partner_id.parent_id.name or '').strip()
                elif lead.partner_id.is_company:
                    company_name = (lead.partner_id.name or '').strip()

            # If contact_name is empty, check if partner_id is an individual contact
            if not contact_name and lead.partner_id and not lead.partner_id.is_company:
                contact_name = (lead.partner_id.name or '').strip()

            address_vals = {
                'street': lead.street or False,
                'street2': lead.street2 or False,
                'city': lead.city or False,
                'zip': lead.zip or False,
                'state_id': lead.state_id.id if lead.state_id else False,
                'country_id': lead.country_id.id if lead.country_id else False,
                'website': lead.website or False,
            }
            clean_address_vals = {k: v for k, v in address_vals.items() if v}

            current_partner = lead.partner_id

            if company_name and contact_name:
                # 1. Company partner
                company_partner = Partner.search([
                    ('name', '=ilike', company_name),
                    ('is_company', '=', True)
                ], limit=1)
                if not company_partner:
                    company_partner = Partner.search([
                        ('name', '=ilike', company_name)
                    ], limit=1)
                    if company_partner:
                        if not company_partner.is_company:
                            company_partner.write({'is_company': True})
                    else:
                        comp_create_vals = {
                            'name': company_name,
                            'is_company': True,
                            **clean_address_vals,
                        }
                        if lead.website:
                            comp_create_vals['website'] = lead.website
                        company_partner = Partner.create(comp_create_vals)

                if clean_address_vals:
                    to_update = {k: v for k, v in clean_address_vals.items() if not company_partner[k]}
                    if to_update:
                        company_partner.write(to_update)

                # 2. Contact partner linked to company
                contact_partner = Partner.search([
                    ('name', '=ilike', contact_name),
                    ('parent_id', '=', company_partner.id),
                ], limit=1)
                if not contact_partner:
                    if current_partner and current_partner != company_partner and not current_partner.is_company:
                        current_partner.write({
                            'name': contact_name,
                            'parent_id': company_partner.id,
                            'is_company': False,
                            'email': lead.email_from or current_partner.email or False,
                            'phone': lead.phone or current_partner.phone or False,
                            'function': lead.function or current_partner.function or False,
                        })
                        contact_partner = current_partner
                    else:
                        contact_partner = Partner.create({
                            'name': contact_name,
                            'is_company': False,
                            'parent_id': company_partner.id,
                            'email': lead.email_from or False,
                            'phone': lead.phone or False,
                            'function': lead.function or False,
                        })
                else:
                    if contact_partner.parent_id != company_partner:
                        contact_partner.write({'parent_id': company_partner.id})

                # Set partner_id to the company partner so customer is created as company
                lead_vals = {
                    'partner_id': company_partner.id,
                    'partner_name': company_name,
                    'contact_name': contact_name,
                }
                lead.with_context(skip_won_partner_check=True).write(lead_vals)

            elif company_name and not contact_name:
                company_partner = Partner.search([
                    ('name', '=ilike', company_name),
                    ('is_company', '=', True)
                ], limit=1)
                if not company_partner:
                    comp_create_vals = {
                        'name': company_name,
                        'is_company': True,
                        **clean_address_vals,
                    }
                    if lead.website:
                        comp_create_vals['website'] = lead.website
                    company_partner = Partner.create(comp_create_vals)

                lead_vals = {
                    'partner_id': company_partner.id,
                    'partner_name': company_name,
                }
                lead.with_context(skip_won_partner_check=True).write(lead_vals)

            elif contact_name and not company_name:
                contact_partner = Partner.search([
                    ('name', '=ilike', contact_name),
                    ('is_company', '=', False)
                ], limit=1)
                if not contact_partner:
                    if current_partner and not current_partner.is_company:
                        current_partner.write({'name': contact_name})
                        contact_partner = current_partner
                    else:
                        contact_partner = Partner.create({
                            'name': contact_name,
                            'is_company': False,
                            'email': lead.email_from or False,
                            'phone': lead.phone or False,
                            'function': lead.function or False,
                        })
                lead_vals = {
                    'partner_id': contact_partner.id,
                    'contact_name': contact_name,
                }
                lead.with_context(skip_won_partner_check=True).write(lead_vals)

    def action_set_won(self):
        res = super().action_set_won()
        self.with_context(skip_won_partner_check=True)._update_partner_on_won()
        return res

    @api.model_create_multi
    def create(self, vals_list):
        if self.env.user.share:
            for vals in vals_list:
                if 'user_id' not in vals:
                    vals['user_id'] = self.env.user.id
        return super().create(vals_list)

    def write(self, vals):
        res = super().write(vals)
        if not self.env.context.get('skip_won_partner_check'):
            # Detect when an opportunity is set to won or probability becomes 100
            if 'stage_id' in vals or 'probability' in vals:
                won_leads = self.filtered(
                    lambda l: l.type == 'opportunity' and (
                        (l.stage_id and l.stage_id.is_won) or l.probability == 100
                    )
                )
                if won_leads:
                    to_finalize = won_leads.filtered(lambda l: l.probability != 100 or not l.date_closed)
                    if to_finalize:
                        to_finalize.with_context(skip_won_partner_check=True).write({
                            'probability': 100.0,
                            'date_closed': fields.Datetime.now(),
                        })
                    won_leads.with_context(skip_won_partner_check=True)._update_partner_on_won()
        return res
