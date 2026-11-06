# -*- coding: utf-8 -*-
import logging
import re
from datetime import datetime, date
from odoo import http, fields, _
from odoo.http import request
from odoo.tools import html2plaintext

_logger = logging.getLogger(__name__)


def _clean_meeting_notes(raw_desc):
    """Strip auto-generated organizer HTML blocks and return clean plain text notes."""
    if not raw_desc:
        return ''
    text = str(raw_desc)
    text = re.sub(r'<div[^>]*>[\s\S]*?Organized by[\s\S]*?</div>', '', text, flags=re.IGNORECASE)
    try:
        clean = html2plaintext(text).strip()
    except Exception:
        clean = re.sub(r'<[^>]+>', ' ', text)
        clean = re.sub(r'\s+', ' ', clean).strip()

    if re.search(r'^\s*Organized by[\s\S]*$', clean, flags=re.IGNORECASE):
        return ''
    clean = re.sub(r'Organized by[\s\S]*?$', '', clean, flags=re.IGNORECASE).strip()
    return clean


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
            first_letter = (name[:1].upper() if name else 'U')
            user_list.append({
                'id': u.id,
                'name': name,
                'initials': first_letter,
                'avatar_url': f'/web/image/res.users/{u.id}/avatar_128' if u.image_128 else None,
            })

        curr_name = user.name or 'User'
        curr_letter = (curr_name[:1].upper() if curr_name else 'U')

        return {
            'success': True,
            'is_admin': is_admin,
            'types': type_list,
            'users': user_list,
            'current_user': {
                'id': user.id,
                'name': curr_name,
                'initials': curr_letter,
                'avatar_url': f'/web/image/res.users/{user.id}/avatar_128' if user.image_128 else None,
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

        # Each user (including admin) only sees their own activities
        lead_acts = lead.activity_ids.filtered(lambda a: a.user_id.id == user.id)

        activities = []
        for act in lead_acts.sorted(key=lambda a: (a.date_deadline or fields.Date.today(), a.id)):
            u = act.user_id
            user_name = u.name if u else _('Unassigned')
            first_letter = (user_name[:1].upper() if user_name else 'U')

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
                'user_initials': first_letter,
                'user_avatar': f'/web/image/res.users/{u.id}/avatar_128' if (u and u.image_128) else None,
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

    # =========================================================================
    # MEETING CALENDAR & EVENT SCHEDULING (FRONTEND CRM PORTAL)
    # =========================================================================

    @http.route('/portal/meeting/get_calendar_data', type='jsonrpc', auth='user', methods=['POST'])
    def get_meeting_calendar_data(self, lead_id=None, target_date=None):
        """
        Fetch calendar events, lead details, attendees list, and user information for the meeting calendar view.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        Lead = request.env['crm.lead'].sudo()
        lead = Lead.browse(int(lead_id)) if lead_id else False

        lead_info = None
        if lead and lead.exists():
            partner = lead.partner_id
            lead_info = {
                'id': lead.id,
                'name': lead.name or '',
                'partner_name': partner.name if partner else (lead.contact_name or ''),
                'partner_id': partner.id if partner else None,
                'user_id': lead.user_id.id if lead.user_id else None,
                'user_name': lead.user_id.name if lead.user_id else '',
            }

        # Candidate attendees: current user, lead partner, and active team members
        attendees = []
        if user.partner_id:
            attendees.append({
                'id': user.partner_id.id,
                'name': user.partner_id.name,
                'is_current_user': True,
                'avatar': f'/web/image/res.users/{user.id}/avatar_128' if user.image_128 else None,
                'initials': (user.name or 'U')[:1].upper(),
            })

        if lead and lead.exists() and lead.partner_id and lead.partner_id.id != user.partner_id.id:
            attendees.append({
                'id': lead.partner_id.id,
                'name': lead.partner_id.name,
                'is_lead_partner': True,
                'avatar': f'/web/image/res.partner/{lead.partner_id.id}/avatar_128' if lead.partner_id.image_128 else None,
                'initials': (lead.partner_id.name or 'C')[:1].upper(),
            })

        other_users = request.env['res.users'].sudo().search([
            ('active', '=', True),
            ('share', '=', False),
            ('id', '!=', user.id),
        ], limit=10)
        for u in other_users:
            if u.partner_id and not any(a['id'] == u.partner_id.id for a in attendees):
                attendees.append({
                    'id': u.partner_id.id,
                    'name': u.name,
                    'is_current_user': False,
                    'avatar': f'/web/image/res.users/{u.id}/avatar_128' if u.image_128 else None,
                    'initials': (u.name or 'U')[:1].upper(),
                })

        # Fetch events from calendar.event
        event_domain = []
        if lead and lead.exists():
            event_domain = [
                '|',
                ('opportunity_id', '=', lead.id),
                '|',
                '&', ('res_model', '=', 'crm.lead'), ('res_id', '=', lead.id),
                ('partner_ids', 'in', [user.partner_id.id]),
            ]
        else:
            event_domain = [('partner_ids', 'in', [user.partner_id.id])]

        Event = request.env['calendar.event'].sudo()
        events_records = Event.search(event_domain, order='start asc', limit=100)

        events_data = []
        for ev in events_records:
            start_dt = ev.start
            stop_dt = ev.stop

            duration_str = ''
            if start_dt and stop_dt:
                diff = stop_dt - start_dt
                total_mins = int(diff.total_seconds() / 60)
                if total_mins >= 60:
                    hrs = total_mins / 60.0
                    if hrs.is_integer():
                        duration_str = f"({int(hrs)} hour{'s' if int(hrs) > 1 else ''})"
                    else:
                        duration_str = f"({hrs:.1f} hours)"
                elif total_mins > 0:
                    duration_str = f"({total_mins} mins)"
            elif getattr(ev, 'duration', 0):
                d = ev.duration
                duration_str = f"({int(d)} hour{'s' if int(d) > 1 else ''})" if d.is_integer() else f"({d:.1f} hours)"

            org_user = ev.user_id or user
            comp_name = org_user.company_id.name if (org_user and org_user.company_id) else ''
            user_display = f"{comp_name}, {org_user.name}" if (comp_name and org_user) else (org_user.name if org_user else 'Mitchell Admin')

            linked_lead_name = ev.opportunity_id.name if ev.opportunity_id else (lead.name if lead and lead.exists() else 'Lead')
            linked_lead_id = ev.opportunity_id.id if ev.opportunity_id else (lead.id if lead and lead.exists() else None)

            events_data.append({
                'id': ev.id,
                'name': ev.name or 'Meeting',
                'start': start_dt.strftime('%Y-%m-%d %H:%M:%S') if start_dt else '',
                'stop': stop_dt.strftime('%Y-%m-%d %H:%M:%S') if stop_dt else '',
                'start_time': start_dt.strftime('%I:%M %p') if start_dt else '',
                'stop_time': stop_dt.strftime('%I:%M %p') if stop_dt else '',
                'date': start_dt.strftime('%Y-%m-%d') if start_dt else '',
                'date_formatted': start_dt.strftime('%B %d, %Y') if start_dt else '',
                'duration_str': duration_str,
                'allday': bool(ev.allday),
                'location': ev.location or '',
                'videocall_location': ev.videocall_location if 'videocall_location' in Event._fields and ev.videocall_location else '',
                'description': _clean_meeting_notes(ev.description),
                'privacy': getattr(ev, 'privacy', 'public') or 'public',
                'lead_id': linked_lead_id,
                'lead_name': linked_lead_name,
                'user_display': user_display,
                'organizer': {
                    'name': org_user.name if org_user else 'Mitchell Admin',
                    'email': (org_user.email or (org_user.partner_id.email if org_user.partner_id else '') or 'admin@example.com') if org_user else 'admin@example.com',
                    'phone': (org_user.phone or (org_user.partner_id.phone if org_user.partner_id else '') or '+1 555-555-5555') if org_user else '+1 555-555-5555',
                    'avatar': f'/web/image/res.users/{org_user.id}/avatar_128' if (org_user and org_user.image_128) else None,
                    'initials': ((org_user.name or 'U')[:1].upper()) if org_user else 'M',
                },
                'attendees': [{
                    'id': p.id,
                    'name': p.name,
                    'avatar': f'/web/image/res.partner/{p.id}/avatar_128' if p.image_128 else None,
                    'initials': (p.name or 'U')[:1].upper(),
                } for p in ev.partner_ids],
            })

        return {
            'success': True,
            'lead': lead_info,
            'current_user': {
                'id': user.id,
                'name': user.name,
                'partner_id': user.partner_id.id,
                'initials': (user.name or 'U')[:1].upper(),
                'avatar': f'/web/image/res.users/{user.id}/avatar_128' if user.image_128 else None,
            },
            'attendees': attendees,
            'events': events_data,
        }

    @http.route('/portal/meeting/create_event', type='jsonrpc', auth='user', methods=['POST'])
    def create_meeting_event(self, lead_id, name, start, stop=None, allday=False, partner_ids=None, location='', videocall_location='', description='', privacy='public'):
        """
        Create a calendar.event linked to a crm.lead, invite attendees, and schedule the corresponding mail.activity.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        Lead = request.env['crm.lead'].sudo()
        lead = Lead.browse(int(lead_id))
        if not lead.exists():
            return {'error': 'Lead not found'}

        # Parse start and stop datetime
        try:
            if 'T' in str(start):
                start_dt = datetime.fromisoformat(str(start).replace('Z', ''))
            else:
                start_dt = datetime.strptime(str(start)[:19], '%Y-%m-%d %H:%M:%S' if len(str(start)) > 10 else '%Y-%m-%d')
        except Exception:
            start_dt = datetime.now().replace(minute=0, second=0, microsecond=0)

        if stop:
            try:
                if 'T' in str(stop):
                    stop_dt = datetime.fromisoformat(str(stop).replace('Z', ''))
                else:
                    stop_dt = datetime.strptime(str(stop)[:19], '%Y-%m-%d %H:%M:%S' if len(str(stop)) > 10 else '%Y-%m-%d')
            except Exception:
                from datetime import timedelta
                stop_dt = start_dt + timedelta(hours=1)
        else:
            from datetime import timedelta
            stop_dt = start_dt + timedelta(hours=1)

        # Prepare partner_ids
        p_ids = []
        if partner_ids and isinstance(partner_ids, list):
            p_ids = [int(p) for p in partner_ids if p]
        if user.partner_id.id not in p_ids:
            p_ids.append(user.partner_id.id)
        if lead.partner_id and lead.partner_id.id not in p_ids:
            p_ids.append(lead.partner_id.id)

        Event = request.env['calendar.event'].sudo()
        vals = {
            'name': name.strip() if name and name.strip() else lead.name,
            'start': start_dt,
            'stop': stop_dt,
            'allday': bool(allday),
            'opportunity_id': lead.id,
            'res_model': 'crm.lead',
            'res_id': lead.id,
            'partner_ids': [(6, 0, p_ids)],
            'description': description.strip() if description else '',
            'privacy': privacy if privacy in ['public', 'private'] else 'public',
            'user_id': user.id,
        }
        if location:
            vals['location'] = location.strip()
        if videocall_location and 'videocall_location' in Event._fields:
            vals['videocall_location'] = videocall_location.strip()

        event = Event.create(vals)

        # Find or ensure mail.activity.type for meeting
        ActType = request.env['mail.activity.type'].sudo()
        meeting_type = ActType.search([
            ('category', '=', 'meeting'),
            '|', ('res_model', '=', False), ('res_model', '=', 'crm.lead'),
        ], limit=1)
        if not meeting_type:
            meeting_type = ActType.search([
                ('name', 'ilike', 'meeting'),
                '|', ('res_model', '=', False), ('res_model', '=', 'crm.lead'),
            ], limit=1)

        if meeting_type:
            sched_vals = {
                'activity_type_id': meeting_type.id,
                'summary': event.name,
                'date_deadline': start_dt.date(),
                'user_id': user.id,
                'note': description or '',
            }
            if 'calendar_event_id' in request.env['mail.activity']._fields:
                sched_vals['calendar_event_id'] = event.id

            lead.activity_schedule(**sched_vals)

        lead.invalidate_recordset(['activity_ids', 'activity_state'])

        return {
            'success': True,
            'event_id': event.id,
            'lead_id': lead.id,
            'name': event.name,
            'start': start_dt.strftime('%Y-%m-%d %H:%M:%S'),
            'stop': stop_dt.strftime('%Y-%m-%d %H:%M:%S'),
            'activity_count': len(lead.activity_ids),
            'activity_state': lead.activity_state or 'planned',
        }

    @http.route('/portal/meeting/delete_event', type='jsonrpc', auth='user', methods=['POST'])
    def delete_meeting_event(self, event_id):
        """
        Delete a calendar.event and its linked mail.activity.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        Event = request.env['calendar.event'].sudo()
        event = Event.browse(int(event_id))
        if not event.exists():
            return {'error': 'Event not found'}

        lead_id = event.opportunity_id.id if event.opportunity_id else (event.res_id if event.res_model == 'crm.lead' else None)

        if 'calendar_event_id' in request.env['mail.activity']._fields:
            acts = request.env['mail.activity'].sudo().search([('calendar_event_id', '=', event.id)])
            acts.unlink()

        event.unlink()

        if lead_id:
            lead = request.env['crm.lead'].sudo().browse(lead_id)
            lead.invalidate_recordset(['activity_ids', 'activity_state'])

        return {'success': True}

    @http.route('/portal/meeting/update_event', type='jsonrpc', auth='user', methods=['POST'])
    def update_meeting_event(self, event_id, name=None, start=None, stop=None, allday=False, location='', videocall_location='', description='', privacy='public'):
        """
        Update an existing calendar.event and its linked mail.activity.
        """
        user = self._get_current_user()
        if not user:
            return {'error': 'Unauthorized'}

        Event = request.env['calendar.event'].sudo()
        event = Event.browse(int(event_id))
        if not event.exists():
            return {'error': 'Event not found'}

        vals = {}
        if name:
            vals['name'] = name.strip()
        if start:
            try:
                if 'T' in str(start):
                    vals['start'] = datetime.fromisoformat(str(start).replace('Z', ''))
                else:
                    vals['start'] = datetime.strptime(str(start)[:19], '%Y-%m-%d %H:%M:%S' if len(str(start)) > 10 else '%Y-%m-%d')
            except Exception:
                pass
        if stop:
            try:
                if 'T' in str(stop):
                    vals['stop'] = datetime.fromisoformat(str(stop).replace('Z', ''))
                else:
                    vals['stop'] = datetime.strptime(str(stop)[:19], '%Y-%m-%d %H:%M:%S' if len(str(stop)) > 10 else '%Y-%m-%d')
            except Exception:
                pass
        vals['allday'] = bool(allday)
        if location is not None:
            vals['location'] = location.strip()
        if videocall_location is not None and 'videocall_location' in Event._fields:
            vals['videocall_location'] = videocall_location.strip()
        if description is not None:
            vals['description'] = description.strip()
        if privacy in ['public', 'private']:
            vals['privacy'] = privacy

        event.write(vals)

        # Update linked mail.activity summary & deadline if present
        if 'calendar_event_id' in request.env['mail.activity']._fields and vals.get('name'):
            acts = request.env['mail.activity'].sudo().search([('calendar_event_id', '=', event.id)])
            act_vals = {'summary': vals['name']}
            if vals.get('start'):
                act_vals['date_deadline'] = vals['start'].date()
            acts.write(act_vals)

        lead_id = event.opportunity_id.id if event.opportunity_id else (event.res_id if event.res_model == 'crm.lead' else None)
        if lead_id:
            lead = request.env['crm.lead'].sudo().browse(lead_id)
            lead.invalidate_recordset(['activity_ids', 'activity_state'])

        start_dt = event.start
        stop_dt = event.stop

        duration_str = ''
        if start_dt and stop_dt:
            diff = stop_dt - start_dt
            total_mins = int(diff.total_seconds() / 60)
            if total_mins >= 60:
                hrs = total_mins / 60.0
                duration_str = f"({int(hrs)} hour{'s' if int(hrs) > 1 else ''})" if hrs.is_integer() else f"({hrs:.1f} hours)"
            elif total_mins > 0:
                duration_str = f"({total_mins} mins)"

        return {
            'success': True,
            'event_id': event.id,
            'name': event.name,
            'start': start_dt.strftime('%Y-%m-%d %H:%M:%S') if start_dt else '',
            'stop': stop_dt.strftime('%Y-%m-%d %H:%M:%S') if stop_dt else '',
            'start_time': start_dt.strftime('%I:%M %p') if start_dt else '',
            'stop_time': stop_dt.strftime('%I:%M %p') if stop_dt else '',
            'date': start_dt.strftime('%Y-%m-%d') if start_dt else '',
            'date_formatted': start_dt.strftime('%B %d, %Y') if start_dt else '',
            'duration_str': duration_str,
            'location': event.location or '',
            'description': _clean_meeting_notes(event.description),
            'privacy': getattr(event, 'privacy', 'public') or 'public',
        }
