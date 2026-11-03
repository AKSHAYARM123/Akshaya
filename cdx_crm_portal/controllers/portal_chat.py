# -*- coding: utf-8 -*-
import base64
import logging
from datetime import datetime
from odoo import http, fields, _
from odoo.http import request
from odoo.tools import html2plaintext

_logger = logging.getLogger(__name__)


class PortalChatController(http.Controller):

    # =========================================================================
    # Helpers
    # =========================================================================

    def _get_current_partner(self):
        """Return the partner of the currently authenticated user, or None if public."""
        user = request.env.user
        if not user or user._is_public():
            return None
        return user.partner_id

    def _clean_message_body(self, raw_body):
        """Clean message body so that HTML tags and double-escaped markup are sanitized to clean plain text."""
        if not raw_body:
            return ""
        import html
        text = str(raw_body).strip()
        # html2plaintext converts html formatting to readable text
        text = html2plaintext(text).strip()
        # Unescape any HTML entities like &lt;p&gt;
        text = html.unescape(text).strip()
        # Strip any literal <p>...</p> tags if previously double-wrapped
        while text.lower().startswith("<p>") and text.lower().endswith("</p>"):
            text = text[3:-4].strip()
            text = html.unescape(text).strip()
        return text

    def _format_date(self, dt):
        """Format datetime in user-friendly discuss style."""
        if not dt:
            return ""
        now = fields.Datetime.now()
        diff = now - dt
        if diff.days == 0 and dt.date() == now.date():
            # Format time e.g. "11:47 am"
            return dt.strftime("%I:%M %p").lstrip("0")
        elif diff.days == 1 or (diff.days == 0 and dt.date() != now.date()):
            return "Yesterday"
        elif diff.days < 7:
            return dt.strftime("%a")
        elif dt.year == now.year:
            return dt.strftime("%b %d")
        else:
            return dt.strftime("%b %d, %Y")

    def _channel_to_dict(self, channel, current_partner):
        """Serialize a discuss.channel into discuss-style dropdown item data."""
        # Member record for current user
        member = channel.channel_member_ids.filtered(lambda m: m.partner_id.id == current_partner.id)[:1]
        unread_count = member.message_unread_counter if member else 0

        # Latest message in this channel
        last_msg = request.env['mail.message'].sudo().search([
            ('model', '=', 'discuss.channel'),
            ('res_id', '=', channel.id),
            ('message_type', 'not in', ('notification', 'user_notification')),
        ], order='id desc', limit=1)

        # Other partner in 1-on-1 chat
        other_partner = None
        if channel.channel_type == 'chat':
            other_members = channel.channel_member_ids.filtered(lambda m: m.partner_id.id != current_partner.id)
            if other_members:
                other_partner = other_members[0].partner_id
            else:
                other_partner = current_partner

        # Display name & avatar
        if channel.channel_type == 'chat' and other_partner:
            display_name = other_partner.name or _("Unknown User")
            avatar_url = f"/web/image/res.partner/{other_partner.id}/avatar_128"
            other_partner_id = other_partner.id
            is_internal = not any(u.share for u in other_partner.user_ids) if other_partner.user_ids else False
        else:
            display_name = channel.name or _("General")
            avatar_url = None
            other_partner_id = None
            is_internal = False

        preview_text = ""
        last_date = ""
        last_date_raw = None
        if last_msg:
            raw_body = self._clean_message_body(last_msg.body)
            if not raw_body and last_msg.attachment_ids:
                raw_body = f"[{_('Attachment')} {last_msg.attachment_ids[0].name}]"
            is_me = (last_msg.author_id.id == current_partner.id)
            author_prefix = _("You: ") if is_me else (f"{last_msg.author_id.name}: " if channel.channel_type != 'chat' else "")
            preview_text = f"{author_prefix}{raw_body}"
            last_date = self._format_date(last_msg.date)
            last_date_raw = last_msg.date.isoformat() if last_msg.date else None
        else:
            preview_text = _("No messages yet")

        return {
            'id': channel.id,
            'name': display_name,
            'channel_type': channel.channel_type,  # 'chat', 'channel', 'group'
            'avatar_url': avatar_url,
            'other_partner_id': other_partner_id,
            'is_internal': is_internal,
            'unread_count': unread_count,
            'last_message': preview_text,
            'last_date': last_date,
            'last_date_raw': last_date_raw,
        }

    # =========================================================================
    # Routes
    # =========================================================================

    @http.route('/portal/chat/unread_count', type='jsonrpc', auth='public', methods=['POST'])
    def get_unread_count(self):
        """Return total unread message count for the current user's discuss channels."""
        current_partner = self._get_current_partner()
        if not current_partner:
            return {'unread_count': 0}

        members = request.env['discuss.channel.member'].sudo().search([
            ('partner_id', '=', current_partner.id)
        ])
        members._compute_message_unread()
        total_unread = sum(m.message_unread_counter for m in members)
        return {'unread_count': total_unread}

    @http.route('/portal/chat/channels', type='jsonrpc', auth='public', methods=['POST'])
    def get_channels(self, tab='all', search_term=None):
        """
        Fetch channels list for the Discuss dropdown.
        tab: 'all', 'chat', or 'channel'
        """
        current_partner = self._get_current_partner()
        if not current_partner:
            return {'error': 'Unauthorized', 'channels': []}

        # Find all channels where current_partner is a member
        members = request.env['discuss.channel.member'].sudo().search([
            ('partner_id', '=', current_partner.id)
        ])
        channel_ids = members.mapped('channel_id.id')
        if not channel_ids:
            return {'channels': []}

        domain = [('id', 'in', channel_ids)]
        if tab == 'chat':
            domain.append(('channel_type', '=', 'chat'))
        elif tab == 'channel':
            domain.append(('channel_type', 'in', ('channel', 'group')))

        channels = request.env['discuss.channel'].sudo().search(domain)

        data = [self._channel_to_dict(c, current_partner) for c in channels]

        # Sort: unread first, then latest message date, then name
        def sort_key(item):
            has_unread = 1 if item['unread_count'] > 0 else 0
            date_val = item['last_date_raw'] or ""
            return (has_unread, date_val)

        data.sort(key=sort_key, reverse=True)

        # Filter by search_term if present
        if search_term and search_term.strip():
            st = search_term.strip().lower()
            data = [c for c in data if st in c['name'].lower() or st in c['last_message'].lower()]

        return {'channels': data}

    @http.route('/portal/chat/users', type='jsonrpc', auth='public', methods=['POST'])
    def get_authorized_users(self, search_term=None):
        """
        Return authorized users that the logged-in user can start a conversation with.
        Excludes public and inactive users.
        """
        current_partner = self._get_current_partner()
        if not current_partner:
            return {'error': 'Unauthorized', 'users': []}

        public_user = request.env.ref('base.public_user', raise_if_not_found=False)
        domain = [
            ('active', '=', True),
            ('id', '!=', request.env.user.id),
        ]
        if public_user:
            domain.append(('id', '!=', public_user.id))

        if search_term and search_term.strip():
            st = search_term.strip()
            domain.extend(['|', ('name', 'ilike', st), ('email', 'ilike', st)])

        users = request.env['res.users'].sudo().search(domain, order='name asc', limit=30)

        result = []
        for u in users:
            partner = u.partner_id
            if not partner:
                continue
            is_internal = not u.share
            result.append({
                'id': u.id,
                'partner_id': partner.id,
                'name': u.name or partner.name,
                'email': u.email or partner.email or '',
                'avatar_url': f"/web/image/res.partner/{partner.id}/avatar_128",
                'is_internal': is_internal,
                'role_label': _("Team / Staff") if is_internal else _("Portal User"),
            })

        return {'users': result}

    @http.route('/portal/chat/get_or_create', type='jsonrpc', auth='public', methods=['POST'])
    def get_or_create_chat(self, partner_id):
        """
        Get existing 1-on-1 chat or create a new one with partner_id.
        Prevents duplicate conversations.
        """
        current_partner = self._get_current_partner()
        if not current_partner:
            return {'error': 'Unauthorized'}

        target_partner = request.env['res.partner'].sudo().browse(partner_id)
        if not target_partner.exists():
            return {'error': 'User not found'}

        # Re-use standard Odoo Discuss method: _get_or_create_chat
        channel = request.env['discuss.channel'].with_user(request.env.user).sudo()._get_or_create_chat([target_partner.id])
        channel_data = self._channel_to_dict(channel, current_partner)

        return {'success': True, 'channel': channel_data}

    @http.route('/portal/chat/messages', type='jsonrpc', auth='public', methods=['POST'])
    def get_messages(self, channel_id, limit=50, mark_as_read=True):
        """
        Fetch conversation history for a channel.
        Strict security: user MUST be a participant of the channel.
        Never exposes messages of any other model.
        """
        current_partner = self._get_current_partner()
        if not current_partner:
            return {'error': 'Unauthorized'}

        channel = request.env['discuss.channel'].sudo().browse(channel_id)
        if not channel.exists():
            return {'error': 'Channel not found'}

        # Participant security check
        is_member = current_partner.id in channel.channel_member_ids.mapped('partner_id.id')
        if not is_member:
            return {'error': 'Access denied'}

        # Fetch messages specifically belonging to this discuss.channel
        domain = [
            ('model', '=', 'discuss.channel'),
            ('res_id', '=', channel.id),
            ('message_type', 'not in', ('notification', 'user_notification')),
        ]
        messages = request.env['mail.message'].sudo().search(domain, order='id asc', limit=limit)

        result_messages = []
        for msg in messages:
            is_me = (msg.author_id.id == current_partner.id)
            attachments_data = []
            for att in msg.attachment_ids:
                attachments_data.append({
                    'id': att.id,
                    'name': att.name,
                    'mimetype': att.mimetype,
                    'url': f"/web/content/{att.id}?download=true",
                    'is_image': (att.mimetype or '').startswith('image/'),
                    'image_url': f"/web/image/{att.id}",
                })

            result_messages.append({
                'id': msg.id,
                'author_id': msg.author_id.id,
                'author_name': msg.author_id.name or _("Unknown"),
                'author_avatar': f"/web/image/res.partner/{msg.author_id.id}/avatar_128",
                'body': self._clean_message_body(msg.body),
                'date': self._format_date(msg.date),
                'date_raw': msg.date.isoformat() if msg.date else None,
                'is_me': is_me,
                'attachments': attachments_data,
            })

        # Mark as read if requested and messages exist
        if mark_as_read and messages:
            member = channel.channel_member_ids.filtered(lambda m: m.partner_id.id == current_partner.id)[:1]
            if member:
                last_msg = messages[-1]
                member._mark_as_read(last_msg.id)

        channel_info = self._channel_to_dict(channel, current_partner)

        return {
            'success': True,
            'channel': channel_info,
            'messages': result_messages,
        }

    @http.route('/portal/chat/send', type='jsonrpc', auth='public', methods=['POST'])
    def send_message(self, channel_id, message="", attachments=None):
        """
        Send a message to a discuss channel.
        attachments: list of dicts with 'name', 'datas' (base64 string), 'mimetype'
        """
        current_partner = self._get_current_partner()
        if not current_partner:
            return {'error': 'Unauthorized'}

        channel = request.env['discuss.channel'].sudo().browse(channel_id)
        if not channel.exists():
            return {'error': 'Channel not found'}

        # Member check
        is_member = current_partner.id in channel.channel_member_ids.mapped('partner_id.id')
        if not is_member:
            return {'error': 'Access denied'}

        message_body = (message or "").strip()
        attachment_ids = []

        if attachments and isinstance(attachments, list):
            for att in attachments:
                name = att.get('name') or 'file'
                datas = att.get('datas')
                if datas:
                    new_att = request.env['ir.attachment'].sudo().create({
                        'name': name,
                        'datas': datas,
                        'res_model': 'discuss.channel',
                        'res_id': channel.id,
                    })
                    attachment_ids.append(new_att.id)

        if not message_body and not attachment_ids:
            return {'error': 'Cannot send empty message'}

        # Post message using standard Discuss / Mail mechanism
        msg = channel.sudo().message_post(
            author_id=current_partner.id,
            email_from=current_partner.email_formatted or current_partner.email,
            body=message_body if message_body else "",
            message_type="comment",
            subtype_xmlid="mail.mt_comment",
            attachment_ids=attachment_ids,
        )

        # Mark sender as having read their own message
        member = channel.channel_member_ids.filtered(lambda m: m.partner_id.id == current_partner.id)[:1]
        if member:
            member._mark_as_read(msg.id)

        attachments_data = []
        for att in msg.attachment_ids:
            attachments_data.append({
                'id': att.id,
                'name': att.name,
                'mimetype': att.mimetype,
                'url': f"/web/content/{att.id}?download=true",
                'is_image': (att.mimetype or '').startswith('image/'),
                'image_url': f"/web/image/{att.id}",
            })

        return {
            'success': True,
            'message': {
                'id': msg.id,
                'author_id': current_partner.id,
                'author_name': current_partner.name,
                'author_avatar': f"/web/image/res.partner/{current_partner.id}/avatar_128",
                'body': self._clean_message_body(msg.body),
                'date': self._format_date(msg.date),
                'date_raw': msg.date.isoformat() if msg.date else None,
                'is_me': True,
                'attachments': attachments_data,
            }
        }

    @http.route('/portal/chat/mark_read', type='jsonrpc', auth='public', methods=['POST'])
    def mark_channel_read(self, channel_id):
        """Mark all messages up to latest in channel as read."""
        current_partner = self._get_current_partner()
        if not current_partner:
            return {'error': 'Unauthorized'}

        channel = request.env['discuss.channel'].sudo().browse(channel_id)
        if not channel.exists():
            return {'error': 'Channel not found'}

        member = channel.channel_member_ids.filtered(lambda m: m.partner_id.id == current_partner.id)[:1]
        if member:
            last_msg = request.env['mail.message'].sudo().search([
                ('model', '=', 'discuss.channel'),
                ('res_id', '=', channel.id),
                ('message_type', 'not in', ('notification', 'user_notification')),
            ], order='id desc', limit=1)
            if last_msg:
                member._mark_as_read(last_msg.id)

        return {'success': True}
