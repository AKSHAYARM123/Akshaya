# -*- coding: utf-8 -*-
import logging
from datetime import datetime, date
from odoo import http, fields, _
from odoo.http import request
from odoo.tools import html2plaintext

_logger = logging.getLogger(__name__)


class PortalActivityController(http.Controller):

    def _get_current_user(self):
        """Return the logged in user or None if public."""
        user = request.env.user
        if not user or user._is_public():
            return None
        return user

    def _is_admin(self, user=None):
        """Check if user has Admin or Sales Manager role (who can assign/select other users)."""
        user = user or self._get_current_user()
        if not user or user._is_public() or user.share or user.has_group('base.group_portal'):
            return False
        if not user.has_group('base.group_user'):
            return False
        return bool(
            user.has_group('base.group_system')
            or user.has_group('base.group_erp_manager')
            or user.has_group('sales_team.group_sale_manager')
        )

    def _format_date(self, dt):
        """Format a date or datetime to 'Mon DD, YYYY'."""
        if not dt:
            return ""
        if isinstance(dt, datetime):
            return dt.strftime("%b %d, %Y")
        if isinstance(dt, date):
            return dt.strftime("%b %d, %Y")
        try:
            d = fields.Date.from_string(str(dt))
            return d.strftime("%b %d, %Y")
        except Exception:
            return str(dt)

    @http.route('/portal/activity/init_data', type='jsonrpc', auth='user', methods=['POST'])
    def get_init_data(self):
        """
        Return available activity types and users for scheduling activities.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        # Fetch active activity types for CRM leads (generic or lead-specific)
        domain = [
            ('active', '=', True),
            '|', ('res_model', '=', False), ('res_model', '=', 'crm.lead'),
        ]
        types = request.env['mail.activity.type'].sudo().search(domain, order='sequence asc, id asc')
        # Filter out HR / time off / leave / allocation activity types
        excluded_keywords = ['time off', 'allocation', 'leave']
        types = types.filtered(
            lambda t: not any(kw in (t.name or '').lower() for kw in excluded_keywords)
        )
        type_list = []
        for t in types:
            # Map default icon based on category/name if not set
            icon = t.icon or 'fa-tasks'
            if not icon or icon == 'fa-tasks':
                tname = (t.name or '').lower()
                if 'to-do' in tname or 'todo' in tname:
                    icon = 'fa-check'
                elif 'email' in tname:
                    icon = 'fa-envelope'
                elif 'call' in tname or 'phone' in tname:
                    icon = 'fa-phone'
                elif 'meet' in tname:
                    icon = 'fa-users'
                elif 'doc' in tname or 'upload' in tname:
                    icon = 'fa-upload'

            type_list.append({
                'id': t.id,
                'name': t.name,
                'category': t.category or 'default',
                'icon': icon,
                'default_summary': t.summary or t.name,
                'delay_count': t.delay_count or 0,
                'delay_unit': t.delay_unit or 'days',
            })

        is_admin = self._is_admin(user)

        # Fetch active users (salespersons / team members)
        public_user = request.env.ref('base.public_user', raise_if_not_found=False)
        domain = [('active', '=', True)]
        if public_user:
            domain.append(('id', '!=', public_user.id))

        if is_admin:
            users = request.env['res.users'].sudo().search(domain, order='name asc')
        else:
            users = user

        user_list = []
        for u in users:
            name = u.name or u.login or 'User'
            initials = ''.join([part[:1] for part in name.split() if part])[:2].upper() or 'U'
            user_list.append({
                'id': u.id,
                'name': name,
                'initials': initials,
                'avatar_url': f'/web/image/res.users/{u.id}/avatar_128',
            })

        curr_name = user.name or 'User'
        curr_initials = ''.join([part[:1] for part in curr_name.split() if part])[:2].upper() or 'U'

        return {
            'success': True,
            'is_admin': is_admin,
            'types': type_list,
            'users': user_list,
            'current_user': {
                'id': user.id,
                'name': curr_name,
                'initials': curr_initials,
                'avatar_url': f'/web/image/res.users/{user.id}/avatar_128',
                'is_admin': is_admin,
            }
        }

    @http.route('/portal/activity/lead_activities', type='jsonrpc', auth='user', methods=['POST'])
    def get_lead_activities(self, lead_id):
        """
        Fetch all scheduled activities for a specific lead / opportunity.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        lead = request.env['crm.lead'].sudo().browse(int(lead_id))
        if not lead.exists():
            return {'error': 'Lead not found'}

        activities = []
        for act in lead.activity_ids.sorted(key=lambda a: (a.date_deadline or fields.Date.today(), a.id)):
            u = act.user_id
            user_name = u.name if u else _('Unassigned')
            initials = ''.join([part[:1] for part in user_name.split() if part])[:2].upper() or 'U'

            state = act.state or 'planned'
            state_label = _('Today') if state == 'today' else (_('Overdue') if state == 'overdue' else _('Planned'))

            activities.append({
                'id': act.id,
                'activity_type_id': act.activity_type_id.id,
                'activity_type_name': act.activity_type_id.name or _('Activity'),
                'activity_type_icon': act.activity_type_id.icon or 'fa-tasks',
                'summary': act.summary or act.activity_type_id.name or _('Activity'),
                'date_deadline': str(act.date_deadline) if act.date_deadline else '',
                'date_deadline_formatted': self._format_date(act.date_deadline),
                'state': state,
                'state_label': state_label,
                'user_id': u.id if u else None,
                'user_name': user_name,
                'user_initials': initials,
                'user_avatar': f'/web/image/res.users/{u.id}/avatar_128' if u else None,
                'note': act.note or '',
                'note_plain': html2plaintext(act.note).strip() if act.note else '',
            })

        return {
            'success': True,
            'lead_id': lead.id,
            'lead_name': lead.name,
            'lead_assigned_user_id': lead.user_id.id if lead.user_id else user.id,
            'activity_state': lead.activity_state or (activities[0]['state'] if activities else False),
            'activity_count': len(activities),
            'activities': activities,
        }

    @http.route('/portal/activity/schedule', type='jsonrpc', auth='user', methods=['POST'])
    def schedule_activity(self, lead_id, activity_type_id, summary='', date_deadline=None, user_id=None, note=''):
        """
        Schedule a new activity on a lead.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        lead = request.env['crm.lead'].sudo().browse(int(lead_id))
        if not lead.exists():
            return {'error': 'Lead not found'}

        act_type_id = int(activity_type_id)
        if self._is_admin(user) and user_id:
            assigned_user_id = int(user_id)
        else:
            assigned_user_id = user.id

        act = lead.sudo().activity_schedule(
            activity_type_id=act_type_id,
            summary=summary.strip() if summary else '',
            date_deadline=date_deadline or fields.Date.today(),
            user_id=assigned_user_id,
            note=note.strip() if note else '',
        )

        # Invalidate lead cache to get fresh activity_state & activity_ids
        lead.invalidate_recordset(['activity_ids', 'activity_state'])

        return {
            'success': True,
            'activity_id': act.id,
            'lead_id': lead.id,
            'activity_count': len(lead.activity_ids),
            'activity_state': lead.activity_state or act.state or 'planned',
        }

    @http.route('/portal/activity/update', type='jsonrpc', auth='user', methods=['POST'])
    def update_activity(self, activity_id, activity_type_id=None, summary=None, date_deadline=None, user_id=None, note=None):
        """
        Update an existing scheduled activity.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        act = request.env['mail.activity'].sudo().browse(int(activity_id))
        if not act.exists():
            return {'error': 'Activity not found'}

        vals = {}
        if activity_type_id is not None:
            vals['activity_type_id'] = int(activity_type_id)
        if summary is not None:
            vals['summary'] = summary.strip()
        if date_deadline:
            vals['date_deadline'] = date_deadline
        if user_id is not None and self._is_admin(user):
            vals['user_id'] = int(user_id) if user_id else user.id
        if note is not None:
            vals['note'] = note.strip()

        if vals:
            act.write(vals)

        lead = request.env['crm.lead'].sudo().browse(act.res_id)
        lead.invalidate_recordset(['activity_ids', 'activity_state'])

        return {
            'success': True,
            'activity_id': act.id,
            'lead_id': lead.id,
            'activity_count': len(lead.activity_ids),
            'activity_state': lead.activity_state or 'planned',
        }

    @http.route('/portal/activity/mark_done', type='jsonrpc', auth='user', methods=['POST'])
    def mark_activity_done(self, activity_id, feedback=''):
        """
        Mark a scheduled activity as done.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        act = request.env['mail.activity'].sudo().browse(int(activity_id))
        if not act.exists():
            return {'error': 'Activity not found'}

        lead_id = act.res_id
        clean_feedback = ""
        if feedback and feedback.strip():
            plain_fb = html2plaintext(feedback).strip()
            plain_act_note = html2plaintext(act.note or '').strip()
            # Only record feedback if it differs from the original activity note
            if plain_fb and plain_fb != plain_act_note:
                clean_feedback = plain_fb

        if clean_feedback:
            act.action_feedback(feedback=clean_feedback)
        else:
            act.action_done()

        lead = request.env['crm.lead'].sudo().browse(lead_id)
        lead.invalidate_recordset(['activity_ids', 'activity_state'])

        return {
            'success': True,
            'lead_id': lead.id,
            'activity_count': len(lead.activity_ids),
            'activity_state': lead.activity_state or False,
        }

    @http.route('/portal/activity/unlink', type='jsonrpc', auth='user', methods=['POST'])
    def unlink_activity(self, activity_id):
        """
        Delete/Cancel a scheduled activity.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        act = request.env['mail.activity'].sudo().browse(int(activity_id))
        if not act.exists():
            return {'error': 'Activity not found'}

        lead_id = act.res_id
        act.unlink()

        lead = request.env['crm.lead'].sudo().browse(lead_id)
        lead.invalidate_recordset(['activity_ids', 'activity_state'])

        return {
            'success': True,
            'lead_id': lead.id,
            'activity_count': len(lead.activity_ids),
            'activity_state': lead.activity_state or False,
        }
