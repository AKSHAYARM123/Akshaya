/* @odoo-module ignore */
/**
 * CRM Portal: Activity Scheduling & Kanban Activity Popover
 * Matches Reference Pictures 1 & 2
 * Handles:
 * - Activity clock button click on Kanban & Lead cards
 * - Activity popover with Today / Overdue / Planned groups and quick actions (Mark Done, Edit, Delete)
 * - Schedule Activity Dialog (Picture 1) with Type pills, Summary, Due Date, Assigned to, and Note
 */

(function () {
    'use strict';

    // State & cache
    var initDataCache = null;
    var activePopoverEl = null;
    var activeModalEl = null;

    // Helper: JSON-RPC call
    async function rpcCall(endpoint, params) {
        try {
            var response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: params || {}
                })
            });
            var data = await response.json();
            if (data.error) {
                console.error('[CRM Portal Activity] RPC error on ' + endpoint + ':', data.error);
                return null;
            }
            return data.result;
        } catch (err) {
            console.error('[CRM Portal Activity] Network error on ' + endpoint + ':', err);
            return null;
        }
    }

    // Helper: Escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Helper: Format date string to YYYY-MM-DD
    function getTodayDateStr() {
        var d = new Date();
        var month = '' + (d.getMonth() + 1);
        var day = '' + d.getDate();
        var year = d.getFullYear();
        if (month.length < 2) month = '0' + month;
        if (day.length < 2) day = '0' + day;
        return [year, month, day].join('-');
    }

    // Helper: Determine FontAwesome icon class for an activity type
    function getActIconClass(typeName) {
        var name = (typeName || '').toLowerCase();
        if (name.includes('email') || name.includes('mail')) return 'fa-envelope';
        if (name.includes('call') || name.includes('phone')) return 'fa-phone';
        if (name.includes('meet')) return 'fa-users';
        if (name.includes('doc') || name.includes('upload')) return 'fa-upload';
        if (name.includes('to-do') || name.includes('todo')) return 'fa-check';
        return 'fa-tasks';
    }

    // Helper: Update lead card button appearance in DOM
    function updateCardButtonState(leadId, state, count) {
        var btns = document.querySelectorAll('.crm-card-activity-btn[data-lead-id="' + leadId + '"]');
        btns.forEach(function (btn) {
            btn.classList.remove('crm-act-today', 'crm-act-overdue', 'crm-act-planned', 'crm-act-none');
            var cls = 'crm-act-none';
            if (state === 'today') cls = 'crm-act-today';
            else if (state === 'overdue') cls = 'crm-act-overdue';
            else if (state === 'planned') cls = 'crm-act-planned';
            btn.classList.add(cls);
            btn.setAttribute('data-act-count', String(count || 0));
            btn.setAttribute('data-act-state', state || '');
            btn.title = count ? (count + ' activity(ies)') : 'Schedule activity';
        });
    }

    // Helper: Re-fetch and update scheduled activity icons on cards for this lead
    async function refreshLeadCardActivities(leadId) {
        if (!leadId) return;
        var data = await rpcCall('/portal/activity/lead_activities', { lead_id: leadId });
        if (!data || !data.success) return;

        var acts = data.activities || [];
        var state = data.activity_state || (acts.length ? acts[0].state : '');
        updateCardButtonState(leadId, state, acts.length);

        var containers = document.querySelectorAll('.crm-card-scheduled-activities[data-lead-id="' + leadId + '"]');
        containers.forEach(function (container) {
            container.innerHTML = '';
            var slice = acts.slice(0, 3);
            slice.forEach(function (act) {
                var btn = document.createElement('button');
                btn.type = 'button';
                var colorCls = 'crm-act-planned';
                if (act.state === 'today') colorCls = 'crm-act-today';
                else if (act.state === 'overdue') colorCls = 'crm-act-overdue';

                btn.className = 'crm-card-act-icon-btn ' + colorCls;
                btn.setAttribute('data-lead-id', leadId);
                btn.setAttribute('data-activity-id', act.id);
                var actTypeName = act.activity_type_name || 'Activity';
                var actSummary = act.summary || actTypeName;
                btn.title = actTypeName + ': ' + actSummary + ' (' + (act.state || '') + ') - Click to edit';

                var iconCls = getActIconClass(actTypeName);
                btn.innerHTML = '<i class="fa ' + escapeHtml(iconCls) + '"></i>';

                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    window.openEditActivityModal(leadId, act.id, btn);
                });

                container.appendChild(btn);
            });
        });

        // Also refresh Activity Matrix Table row if visible
        refreshActivityMatrixRow(leadId, acts);
    }

    // Helper: Update an entire row in the Activity Matrix Table (Picture 1)
    function refreshActivityMatrixRow(leadId, activities) {
        var row = document.querySelector('#crm_activity_table tr.crm-activity-lead-row[data-lead-id="' + leadId + '"]');
        if (!row) return;

        var container = document.getElementById('crm_activity_view_container');
        var isAdmin = container ? (container.getAttribute('data-is-admin') === 'true') : false;
        var currentUserId = container ? container.getAttribute('data-current-user-id') : null;

        var remainingActs = (activities || []).filter(function (a) {
            return (!currentUserId || !a.user_id || String(a.user_id) === String(currentUserId));
        });

        // Hide row if no activities match the user's view scope
        if (remainingActs.length === 0) {
            row.style.display = 'none';
        } else {
            row.style.display = '';
        }

        var typeHeaders = document.querySelectorAll('#crm_activity_table th.crm-act-col-type');
        typeHeaders.forEach(function (th) {
            var typeId = th.getAttribute('data-type-id');
            var cell = row.querySelector('.crm-act-matrix-cell[data-type-id="' + typeId + '"]');
            if (!cell) return;

            var matchingActs = (activities || []).filter(function (a) {
                if (String(a.activity_type_id) !== String(typeId)) return false;
                return (!currentUserId || !a.user_id || String(a.user_id) === String(currentUserId));
            });

            if (matchingActs.length > 0) {
                var html = '';
                matchingActs.forEach(function (act) {
                    var actSt = act.state || 'planned';
                    var colorCls = (actSt === 'overdue') ? 'crm-act-card-overdue' : ((actSt === 'today') ? 'crm-act-card-today' : 'crm-act-card-planned');
                    var userName = act.user_name || 'User';
                    var userFirstLetter = act.user_initials || (userName.charAt(0) || 'U').toUpperCase();
                    var dateFormatted = act.date_deadline_formatted || act.date_deadline || '';
                    if (act.date_deadline && act.date_deadline.includes('-')) {
                        var parts = act.date_deadline.split('-');
                        if (parts.length === 3) {
                            dateFormatted = parts[1] + '/' + parts[2] + '/' + parts[0];
                        }
                    }

                    html += '<div class="crm-act-card ' + colorCls + '" data-activity-id="' + act.id + '" data-lead-id="' + leadId + '" data-type-id="' + typeId + '" data-state="' + actSt + '" title="' + escapeHtml(act.activity_type_name || 'Activity') + ': ' + escapeHtml(act.summary || '') + ' (' + actSt + ') - Click to view/edit">';
                    html += '  <div class="crm-act-card-body">';
                    html += '    <div class="crm-act-card-summary" title="' + escapeHtml(act.summary || '') + '">' + escapeHtml(act.summary || act.activity_type_name || 'Activity') + '</div>';
                    html += '    <div class="crm-act-card-footer">';
                    html += '      <span class="crm-act-card-date">' + escapeHtml(dateFormatted) + '</span>';
                    html += '      <div class="crm-act-card-user" title="' + escapeHtml(userName) + '">';
                    if (act.user_avatar) {
                        html += '        <img src="' + escapeHtml(act.user_avatar) + '" class="crm-act-card-user-img rounded-circle" alt="' + escapeHtml(userName) + '" onerror="this.style.display=\'none\'; if(this.nextElementSibling) this.nextElementSibling.style.display=\'flex\';"/>';
                    }
                    html += '        <span class="crm-act-card-user-circle" style="' + (act.user_avatar ? 'display:none;' : 'display:flex;') + '">' + escapeHtml(userFirstLetter) + '</span>';
                    html += '      </div>';
                    html += '    </div>';
                    html += '  </div>';
                    html += '</div>';
                });
                cell.innerHTML = html;
            } else {
                var typeName = th.querySelector('.crm-act-header-name') ? th.querySelector('.crm-act-header-name').textContent.trim() : 'Activity';
                cell.innerHTML = '<div class="crm-act-cell-empty" data-lead-id="' + leadId + '" data-type-id="' + typeId + '" title="Schedule ' + escapeHtml(typeName) + '"><span class="crm-act-cell-add-icon">+</span></div>';
            }
        });

        if (window.updateCrmActivityHeaderStats) {
            window.updateCrmActivityHeaderStats();
        }
    }

    // Helper: Close existing popover
    function closePopover() {
        if (activePopoverEl && activePopoverEl.parentNode) {
            activePopoverEl.parentNode.removeChild(activePopoverEl);
        }
        activePopoverEl = null;
    }

    // Helper: Close existing modal
    function closeModal() {
        if (activeModalEl && activeModalEl.parentNode) {
            activeModalEl.parentNode.removeChild(activeModalEl);
        }
        activeModalEl = null;
    }

    // Fetch or return cached init data
    async function getInitData() {
        if (initDataCache) return initDataCache;
        var res = await rpcCall('/portal/activity/init_data');
        if (res && res.success) {
            if (res.types && Array.isArray(res.types)) {
                res.types = res.types.filter(function (t) {
                    var n = (t.name || '').toLowerCase();
                    return !n.includes('time off') && !n.includes('allocation') && !n.includes('leave');
                });
            }
            initDataCache = res;
            return res;
        }
        return null;
    }

    // =========================================================================
    // 1. Activity Popover (Picture 2: "2. Click: popover")
    // =========================================================================
    window.toggleCrmActivityPopover = async function (btn, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }

        var leadId = btn.getAttribute('data-lead-id');
        if (!leadId) return;

        // If clicking the same button and popover is already open, close it
        if (activePopoverEl && activePopoverEl._targetBtn === btn) {
            closePopover();
            return;
        }

        closePopover();

        // Fetch lead's activities
        var data = await rpcCall('/portal/activity/lead_activities', { lead_id: leadId });
        if (!data || !data.success) {
            console.error('Failed to load activities for lead', leadId);
            return;
        }

        // If no activities scheduled, open the Schedule Activity dialog directly
        if (!data.activities || data.activities.length === 0) {
            openScheduleActivityModal(leadId, null, btn);
            return;
        }

        // Create popover element
        var popover = document.createElement('div');
        popover.className = 'crm-activity-popover';
        popover._targetBtn = btn;
        popover._leadId = leadId;

        // Group activities by state (today, overdue, planned)
        var groups = {
            today: { label: 'Today', badgeClass: 'badge-today', items: [] },
            overdue: { label: 'Overdue', badgeClass: 'badge-overdue', items: [] },
            planned: { label: 'Planned', badgeClass: 'badge-planned', items: [] },
        };

        data.activities.forEach(function (act) {
            var st = act.state || 'planned';
            if (groups[st]) {
                groups[st].items.push(act);
            } else {
                groups.planned.items.push(act);
            }
        });

        var html = '';
        var order = ['today', 'overdue', 'planned'];

        order.forEach(function (key) {
            var grp = groups[key];
            if (grp.items.length > 0) {
                html += '<div class="crm-act-popover-group">';
                html += '  <div class="crm-act-popover-group-header">';
                html += '    <span>' + escapeHtml(grp.label) + '</span>';
                html += '    <span class="crm-act-popover-badge ' + grp.badgeClass + '">' + grp.items.length + '</span>';
                html += '  </div>';

                grp.items.forEach(function (act) {
                    html += '<div class="crm-act-popover-item" data-activity-id="' + act.id + '">';
                    html += '  <div class="crm-act-item-header">';
                    html += '    <span class="crm-act-item-title" title="Click to edit">' + escapeHtml(act.summary || act.activity_type_name) + '</span>';
                    html += '    <div class="crm-act-item-actions">';
                    html += '      <button type="button" class="crm-act-action-btn crm-act-done-btn" title="Mark Done" data-act-id="' + act.id + '"><i class="fa fa-check"></i></button>';
                    html += '      <button type="button" class="crm-act-action-btn crm-act-edit-btn" title="Edit Activity" data-act-id="' + act.id + '"><i class="fa fa-pencil"></i></button>';
                    html += '      <button type="button" class="crm-act-action-btn crm-act-delete-btn" title="Cancel Activity" data-act-id="' + act.id + '"><i class="fa fa-times"></i></button>';
                    html += '    </div>';
                    html += '  </div>';
                    html += '  <div class="crm-act-item-user">';
                    html += '    <span class="crm-act-user-circle">' + escapeHtml(act.user_initials || 'U') + '</span>';
                    html += '    <span>' + escapeHtml(act.user_name || 'Unassigned') + '</span>';
                    html += '  </div>';
                    html += '</div>';
                });

                html += '</div>';
            }
        });

        // Separator & Schedule Link (Picture 2)
        html += '<div class="crm-act-popover-sep"></div>';
        html += '<button type="button" class="crm-act-schedule-new-btn"><i class="fa fa-plus me-1"></i> Schedule an activity</button>';

        popover.innerHTML = html;
        document.body.appendChild(popover);
        activePopoverEl = popover;

        // Position popover right under clock button
        var rect = btn.getBoundingClientRect();
        var popoverWidth = 290;
        var top = rect.bottom + 6;
        var left = rect.right - popoverWidth;
        if (left < 10) left = 10;
        if (left + popoverWidth > window.innerWidth - 10) {
            left = window.innerWidth - popoverWidth - 10;
        }

        popover.style.top = top + 'px';
        popover.style.left = left + 'px';

        // Bind Popover Actions
        // 1. Mark Done (✓)
        popover.querySelectorAll('.crm-act-done-btn').forEach(function (btnDone) {
            btnDone.addEventListener('click', async function (e) {
                e.stopPropagation();
                var actId = btnDone.getAttribute('data-act-id');
                btnDone.disabled = true;
                var res = await rpcCall('/portal/activity/mark_done', { activity_id: actId });
                if (res && res.success) {
                    await refreshLeadCardActivities(leadId);
                    closePopover();
                    // If still has activities, reopen refreshed
                    if (res.activity_count > 0) {
                        window.toggleCrmActivityPopover(btn);
                    }
                }
            });
        });

        // 2. Edit (✎)
        popover.querySelectorAll('.crm-act-edit-btn, .crm-act-item-title').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                var itemEl = el.closest('.crm-act-popover-item');
                var actId = parseInt(itemEl.getAttribute('data-activity-id'), 10);
                var actData = data.activities.find(function (a) { return a.id === actId; });
                closePopover();
                openScheduleActivityModal(leadId, actData, btn);
            });
        });

        // 3. Delete (✕)
        popover.querySelectorAll('.crm-act-delete-btn').forEach(function (btnDel) {
            btnDel.addEventListener('click', async function (e) {
                e.stopPropagation();
                var actId = btnDel.getAttribute('data-act-id');
                btnDel.disabled = true;
                var res = await rpcCall('/portal/activity/unlink', { activity_id: actId });
                if (res && res.success) {
                    await refreshLeadCardActivities(leadId);
                    closePopover();
                    if (res.activity_count > 0) {
                        window.toggleCrmActivityPopover(btn);
                    }
                }
            });
        });

        // 4. + Schedule an activity button
        var btnSched = popover.querySelector('.crm-act-schedule-new-btn');
        if (btnSched) {
            btnSched.addEventListener('click', function (e) {
                e.stopPropagation();
                closePopover();
                openScheduleActivityModal(leadId, null, btn);
            });
        }
    };

    // Close popover when clicking anywhere outside
    document.addEventListener('click', function (e) {
        if (activePopoverEl && !activePopoverEl.contains(e.target)) {
            closePopover();
        }
    });

    // =========================================================================
    // 2. Schedule Activity Dialog / Modal (Picture 1)
    // =========================================================================
    async function openScheduleActivityModal(leadId, activityData, targetBtn) {
        closeModal();
        closePopover();

        var initData = await getInitData();
        if (!initData) {
            console.error('Cannot load init data for activity modal');
            return;
        }

        var rawTypes = initData.types || [];
        var types = rawTypes.filter(function (t) {
            var n = (t.name || '').toLowerCase();
            return !n.includes('time off') && !n.includes('allocation') && !n.includes('leave');
        });
        var users = initData.users || [];
        var currentUser = initData.current_user || {};
        var isAdmin = !!(initData.is_admin || (currentUser && currentUser.is_admin));

        var isEditing = !!(activityData && activityData.id);

        // Preselected values
        var selectedTypeId = isEditing ? activityData.activity_type_id : (types.length > 0 ? types[0].id : null);
        var initialSummary = isEditing ? (activityData.summary || '') : (types.length > 0 ? (types[0].default_summary || types[0].name) : '');
        var initialDate = isEditing ? (activityData.date_deadline || getTodayDateStr()) : getTodayDateStr();
        var initialUserId = isEditing ? (activityData.user_id || currentUser.id) : (currentUser.id || (users.length > 0 ? users[0].id : null));
        var initialNote = isEditing ? (activityData.note || '') : '';

        // Assigned user:
        // Admin gets a dropdown to choose any user (defaults to current user on schedule, or activity user on edit)
        // Regular portal user only sees their own user as static text (no dropdown)
        var displayUserId, displayName, displayInitials;
        if (isAdmin) {
            var targetUserId = initialUserId || currentUser.id;
            var assignedUser = users.find(function (u) { return u.id === targetUserId; }) || currentUser;
            displayUserId = (assignedUser && assignedUser.id) || targetUserId || null;
            displayName = (assignedUser && assignedUser.name) || 'User';
            displayInitials = (assignedUser && assignedUser.initials) || 'U';
        } else {
            var assignedUser = (currentUser && currentUser.id) ? currentUser : (users.find(function (u) { return u.id === initialUserId; }) || {});
            displayUserId = (currentUser && currentUser.id) || assignedUser.id || initialUserId || null;
            displayName = (currentUser && currentUser.name) || assignedUser.name || 'User';
            displayInitials = (currentUser && currentUser.initials) || assignedUser.initials || 'U';
        }

        // Build Modal Backdrop & Container
        var backdrop = document.createElement('div');
        backdrop.className = 'crm-act-backdrop';

        var dialog = document.createElement('div');
        dialog.className = 'crm-act-dialog';

        // 1. Header (Picture 2: Edit Activity / Schedule Activity)
        var html = '';
        html += '<div class="crm-act-dialog-header">';
        html += '  <h3 class="crm-act-dialog-title">' + (isEditing ? 'Edit Activity' : 'Schedule Activity') + '</h3>';
        html += '  <button type="button" class="crm-act-dialog-close" title="Close">✕</button>';
        html += '</div>';

        // 2. Body
        html += '<div class="crm-act-dialog-body">';

        // Activity Type selection pills (Matching Picture 1 & 2)
        html += '  <div class="crm-act-type-pills">';
        types.forEach(function (t) {
            var isActive = (t.id === selectedTypeId);
            var activeCls = isActive ? ' active' : '';
            var iconHtml = isActive ? '<i class="fa fa-check"></i>' : ('<i class="fa ' + escapeHtml(t.icon || 'fa-tasks') + '"></i>');
            html += '    <button type="button" class="crm-act-type-pill' + activeCls + '" data-type-id="' + t.id + '" data-category="' + escapeHtml(t.category || '') + '" data-default-summary="' + escapeHtml(t.default_summary || t.name) + '" data-icon="' + escapeHtml(t.icon || 'fa-tasks') + '">';
            html += '      ' + iconHtml + ' <span>' + escapeHtml(t.name) + '</span>';
            html += '    </button>';
        });
        html += '  </div>';

        // Meeting Banner Container (Matching Picture 1 when Meeting pill is active)
        html += '  <div id="crm_act_meeting_banner" class="crm-act-meeting-banner" style="display: none;">';
        html += '    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
        html += '      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>';
        html += '      <line x1="16" y1="2" x2="16" y2="6"></line>';
        html += '      <line x1="8" y1="2" x2="8" y2="6"></line>';
        html += '      <line x1="3" y1="10" x2="21" y2="10"></line>';
        html += '      <line x1="8" y1="14" x2="8.01" y2="14"></line>';
        html += '      <line x1="12" y1="14" x2="12.01" y2="14"></line>';
        html += '      <line x1="16" y1="14" x2="16.01" y2="14"></line>';
        html += '      <line x1="8" y1="18" x2="8.01" y2="18"></line>';
        html += '      <line x1="12" y1="18" x2="12.01" y2="18"></line>';
        html += '      <line x1="16" y1="18" x2="16.01" y2="18"></line>';
        html += '    </svg>';
        html += '    <div class="crm-act-meeting-banner-text">Schedule a meeting in your calendar</div>';
        html += '  </div>';

        // Standard Fields Container (Summary, Due Date, Assigned to, Log a note)
        html += '  <div id="crm_act_standard_fields">';
        html += '    <div class="crm-act-field-row">';
        html += '      <label class="crm-act-field-label">Summary</label>';
        html += '      <div class="crm-act-field-control">';
        html += '        <input type="text" id="crm_act_summary_input" class="crm-act-text-input" value="' + escapeHtml(initialSummary) + '" placeholder="Summary">';
        html += '      </div>';
        html += '    </div>';

        html += '    <div class="crm-act-field-row">';
        html += '      <label class="crm-act-field-label">Due Date</label>';
        html += '      <div class="crm-act-field-control">';
        html += '        <input type="date" id="crm_act_date_input" class="crm-act-text-input" value="' + escapeHtml(initialDate) + '">';
        html += '      </div>';
        html += '    </div>';

        html += '    <div class="crm-act-field-row crm-act-field-row-user">';
        html += '      <label class="crm-act-field-label">Assigned to</label>';
        html += '      <div class="crm-act-field-control">';
        html += '        <div class="crm-act-user-wrapper">';
        html += '          <span id="crm_act_user_avatar" class="crm-act-user-avatar-pill">' + escapeHtml(displayInitials) + '</span>';
        if (isAdmin) {
            html += '          <select id="crm_act_user_id" class="crm-act-user-select" title="Assigned to">';
            var userInList = users.some(function (u) { return u.id === displayUserId; });
            if (!userInList && displayUserId) {
                html += '            <option value="' + escapeHtml(displayUserId) + '" selected="selected">' + escapeHtml(displayName) + '</option>';
            }
            users.forEach(function (u) {
                var isSelected = (u.id === displayUserId);
                html += '            <option value="' + u.id + '"' + (isSelected ? ' selected="selected"' : '') + '>' + escapeHtml(u.name) + '</option>';
            });
            html += '          </select>';
        } else {
            html += '          <span id="crm_act_user_name" class="crm-act-user-name-text">' + escapeHtml(displayName) + '</span>';
            html += '          <input type="hidden" id="crm_act_user_id" value="' + escapeHtml(displayUserId) + '">';
        }
        html += '        </div>';
        html += '      </div>';
        html += '    </div>';

        // Log a note row
        html += '    <div class="crm-act-note-row">';
        html += '      <div id="crm_act_note_input" class="crm-act-note-input" contenteditable="true" data-placeholder="Log a note..." role="textbox" aria-multiline="true"></div>';
        html += '    </div>';
        html += '  </div>'; // End crm_act_standard_fields

        html += '</div>'; // End body

        // 3. Footer Buttons (Matching Picture 1 & 2: Purple Schedule button for Meeting, Save/Done for others)
        html += '<div class="crm-act-dialog-footer">';
        html += '  <button type="button" class="crm-act-btn-schedule" id="crm_act_schedule_btn" style="display: none;">Schedule</button>';
        html += '  <button type="button" class="crm-act-btn-save" id="crm_act_save_btn">Save</button>';
        html += '  <button type="button" class="crm-act-btn-done" id="crm_act_done_btn">Mark Done</button>';
        html += '  <button type="button" class="crm-act-btn-discard">Discard</button>';
        html += '</div>';

        dialog.innerHTML = html;
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        activeModalEl = backdrop;

        // Elements
        var closeBtn = dialog.querySelector('.crm-act-dialog-close');
        var discardBtn = dialog.querySelector('.crm-act-btn-discard');
        var saveBtn = dialog.querySelector('.crm-act-btn-save');
        var doneBtn = dialog.querySelector('.crm-act-btn-done');
        var summaryInput = dialog.querySelector('#crm_act_summary_input');
        var dateInput = dialog.querySelector('#crm_act_date_input');
        var userIdInput = dialog.querySelector('#crm_act_user_id');
        var userAvatar = dialog.querySelector('#crm_act_user_avatar');
        var noteInput = dialog.querySelector('#crm_act_note_input');
        var pills = dialog.querySelectorAll('.crm-act-type-pill');

        var currentSelectedTypeId = selectedTypeId;

        // When admin changes user select dropdown, update initials avatar pill
        if (isAdmin && userIdInput && userIdInput.tagName === 'SELECT') {
            userIdInput.addEventListener('change', function () {
                var selectedId = parseInt(this.value, 10);
                var found = users.find(function (u) { return u.id === selectedId; });
                if (found && userAvatar) {
                    userAvatar.textContent = found.initials || 'U';
                }
            });
        }

        // Contenteditable note setup: render existing HTML or plain text cleanly
        function updateNoteEmptyState() {
            var text = (noteInput.textContent || '').trim();
            var hasTags = !!noteInput.querySelector('img, a, strong, b, div, p, span, br');
            if (!text && !hasTags) {
                noteInput.setAttribute('data-empty', 'true');
            } else {
                noteInput.removeAttribute('data-empty');
            }
        }

        if (initialNote && initialNote.trim()) {
            noteInput.innerHTML = initialNote;
        } else {
            noteInput.innerHTML = '';
        }
        updateNoteEmptyState();

        noteInput.addEventListener('input', updateNoteEmptyState);
        noteInput.addEventListener('blur', updateNoteEmptyState);
        noteInput.addEventListener('click', function (e) {
            if (e.target.tagName === 'A') {
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                }
            }
        });

        function getNoteHtml() {
            var text = (noteInput.textContent || '').trim();
            var hasTags = !!noteInput.querySelector('img, a, strong, b, div, p, span');
            if (!text && !hasTags) {
                return '';
            }
            return noteInput.innerHTML.trim();
        }

        function getNotePlainText() {
            return (noteInput.innerText || noteInput.textContent || '').trim();
        }

        // Close on backdrop or Discard or ✕
        function handleClose() {
            closeModal();
        }
        closeBtn.addEventListener('click', handleClose);
        discardBtn.addEventListener('click', handleClose);
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) handleClose();
        });

        // Toggle Meeting View Mode (Matching Picture 1: Calendar Graphic + Schedule Button)
        var schedBtn = dialog.querySelector('#crm_act_schedule_btn');
        var banner = dialog.querySelector('#crm_act_meeting_banner');
        var stdFields = dialog.querySelector('#crm_act_standard_fields');

        function toggleMeetingMode(isMeeting) {
            if (banner) banner.style.display = isMeeting ? 'block' : 'none';
            if (stdFields) stdFields.style.display = isMeeting ? 'none' : 'block';
            if (schedBtn) schedBtn.style.display = isMeeting ? 'inline-block' : 'none';
            if (saveBtn) saveBtn.style.display = isMeeting ? 'none' : 'inline-block';
            if (doneBtn) doneBtn.style.display = isMeeting ? 'none' : 'inline-block';
        }

        if (schedBtn) {
            schedBtn.addEventListener('click', function () {
                closeModal();
                if (window.openCrmMeetingCalendar) {
                    window.openCrmMeetingCalendar(leadId);
                }
            });
        }

        // Pill Selection Logic (Picture 1: pill checkmark and blue tint)
        pills.forEach(function (pill) {
            pill.addEventListener('click', function () {
                pills.forEach(function (p) {
                    p.classList.remove('active');
                    var origIcon = p.getAttribute('data-icon') || 'fa-tasks';
                    var span = p.querySelector('span');
                    p.innerHTML = '<i class="fa ' + escapeHtml(origIcon) + '"></i> <span>' + (span ? span.textContent : '') + '</span>';
                });

                pill.classList.add('active');
                var spanNow = pill.querySelector('span');
                pill.innerHTML = '<i class="fa fa-check"></i> <span>' + (spanNow ? spanNow.textContent : '') + '</span>';

                currentSelectedTypeId = parseInt(pill.getAttribute('data-type-id'), 10);
                var defSummary = pill.getAttribute('data-default-summary') || '';
                var cat = pill.getAttribute('data-category') || '';
                var pName = (spanNow ? spanNow.textContent : '').toLowerCase();
                var isMeet = (cat === 'meeting' || pName.includes('meet'));
                toggleMeetingMode(isMeet);

                // If summary matches another default or is blank, update to new default
                var currentVal = summaryInput.value.trim();
                var isDefault = !currentVal || types.some(function (t) { return t.name === currentVal || t.default_summary === currentVal; });
                if (isDefault) {
                    summaryInput.value = defSummary;
                }
            });
        });

        // Initialize mode based on currently active pill
        var activePill = dialog.querySelector('.crm-act-type-pill.active');
        if (activePill) {
            var initCat = activePill.getAttribute('data-category') || '';
            var initName = activePill.textContent.toLowerCase();
            if (initCat === 'meeting' || initName.includes('meet')) {
                toggleMeetingMode(true);
            }
        }

        // Helper to retrieve assigned user ID (logged-in user)
        function getAssignedUserId() {
            if (userIdInput && userIdInput.value) {
                var parsed = parseInt(userIdInput.value, 10);
                if (!isNaN(parsed)) return parsed;
            }
            return displayUserId || (currentUser && currentUser.id) || null;
        }

        // Save Action
        saveBtn.addEventListener('click', async function () {
            var summary = summaryInput.value.trim() || initialSummary;
            var deadline = dateInput.value || getTodayDateStr();
            var userId = getAssignedUserId();
            var note = getNoteHtml();

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            var res = null;
            if (isEditing) {
                res = await rpcCall('/portal/activity/update', {
                    activity_id: activityData.id,
                    activity_type_id: currentSelectedTypeId,
                    summary: summary,
                    date_deadline: deadline,
                    user_id: userId,
                    note: note
                });
            } else {
                res = await rpcCall('/portal/activity/schedule', {
                    lead_id: leadId,
                    activity_type_id: currentSelectedTypeId,
                    summary: summary,
                    date_deadline: deadline,
                    user_id: userId,
                    note: note
                });
            }

            if (res && res.success) {
                await refreshLeadCardActivities(leadId);
                closeModal();
            } else {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
                alert('Could not save activity. Please try again.');
            }
        });

        // Mark Done Action
        doneBtn.addEventListener('click', async function () {
            var note = getNoteHtml();
            var plainNote = getNotePlainText();
            var plainInitial = '';
            if (initialNote) {
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = initialNote;
                plainInitial = (tempDiv.innerText || tempDiv.textContent || '').trim();
            }

            // Only send feedback if user entered new or updated notes
            var feedbackToSend = (plainNote && plainNote !== plainInitial) ? plainNote : '';

            doneBtn.disabled = true;
            doneBtn.textContent = 'Marking Done...';

            var res = null;
            if (isEditing) {
                // If user modified the note, save it first
                if (note !== initialNote) {
                    await rpcCall('/portal/activity/update', {
                        activity_id: activityData.id,
                        activity_type_id: currentSelectedTypeId,
                        summary: summaryInput.value.trim() || initialSummary,
                        date_deadline: dateInput.value || getTodayDateStr(),
                        user_id: getAssignedUserId(),
                        note: note
                    });
                }
                res = await rpcCall('/portal/activity/mark_done', {
                    activity_id: activityData.id,
                    feedback: feedbackToSend
                });
            } else {
                // If creating and immediately marking done:
                var summary = summaryInput.value.trim() || initialSummary;
                var deadline = dateInput.value || getTodayDateStr();
                var userId = getAssignedUserId();
                var schedRes = await rpcCall('/portal/activity/schedule', {
                    lead_id: leadId,
                    activity_type_id: currentSelectedTypeId,
                    summary: summary,
                    date_deadline: deadline,
                    user_id: userId,
                    note: note
                });
                if (schedRes && schedRes.success && schedRes.activity_id) {
                    res = await rpcCall('/portal/activity/mark_done', {
                        activity_id: schedRes.activity_id,
                        feedback: ''
                    });
                }
            }

            if (res && res.success) {
                await refreshLeadCardActivities(leadId);
                closeModal();
            } else {
                doneBtn.disabled = false;
                doneBtn.textContent = 'Mark Done';
                alert('Could not mark activity as done.');
            }
        });
    }

    // Expose functions globally for card and popover interactions
    window.openScheduleActivityModal = openScheduleActivityModal;
    window.refreshLeadCardActivities = refreshLeadCardActivities;

    // Direct edit handler when clicking an activity icon on a lead card or matrix cell
    window.openEditActivityModal = async function (leadId, activityId, targetBtn) {
        if (!leadId) return;
        var data = await rpcCall('/portal/activity/lead_activities', { lead_id: leadId });
        if (!data || !data.success) {
            console.error('Failed to load activity details for lead', leadId);
            return;
        }
        var actData = (data.activities || []).find(function (a) {
            return String(a.id) === String(activityId);
        });
        if (!actData && data.activities && data.activities.length > 0) {
            actData = data.activities[0];
        }
        openScheduleActivityModal(leadId, actData || null, targetBtn);
    };

    // Calculate & render summary progress bars & fraction count in activity table headers (Picture 1)
    window.updateCrmActivityHeaderStats = function () {
        var table = document.getElementById('crm_activity_table');
        if (!table) return;

        var typeHeaders = table.querySelectorAll('th.crm-act-col-type');
        var visibleRows = table.querySelectorAll('tr.crm-activity-lead-row:not([style*="display: none"])');

        typeHeaders.forEach(function (th) {
            var typeId = th.getAttribute('data-type-id');
            var plannedCount = 0;
            var todayCount = 0;
            var overdueCount = 0;

            visibleRows.forEach(function (row) {
                var cell = row.querySelector('.crm-act-matrix-cell[data-type-id="' + typeId + '"]');
                if (cell) {
                    var cards = cell.querySelectorAll('.crm-act-card');
                    cards.forEach(function (card) {
                        var st = card.getAttribute('data-state');
                        if (st === 'overdue' || card.classList.contains('crm-act-card-overdue')) {
                            overdueCount++;
                        } else if (st === 'today' || card.classList.contains('crm-act-card-today')) {
                            todayCount++;
                        } else {
                            plannedCount++;
                        }
                    });
                }
            });

            var totalCount = plannedCount + todayCount + overdueCount;

            var progBar = th.querySelector('.crm-act-progress-bar');
            if (progBar) {
                var segPlanned = progBar.querySelector('.crm-prog-planned');
                var segToday = progBar.querySelector('.crm-prog-today');
                var segOverdue = progBar.querySelector('.crm-prog-overdue');

                if (totalCount > 0) {
                    var pctPlanned = (plannedCount / totalCount) * 100;
                    var pctToday = (todayCount / totalCount) * 100;
                    var pctOverdue = (overdueCount / totalCount) * 100;

                    if (segPlanned) segPlanned.style.width = pctPlanned + '%';
                    if (segToday) segToday.style.width = pctToday + '%';
                    if (segOverdue) segOverdue.style.width = pctOverdue + '%';
                    progBar.style.display = 'flex';
                } else {
                    if (segPlanned) segPlanned.style.width = '0%';
                    if (segToday) segToday.style.width = '0%';
                    if (segOverdue) segOverdue.style.width = '0%';
                    progBar.style.display = 'none';
                }
            }

            var fractionEl = th.querySelector('.crm-act-count-fraction');
            if (fractionEl) {
                if (totalCount > 0) {
                    fractionEl.textContent = totalCount + ' /' + totalCount;
                    fractionEl.style.display = 'inline-block';
                } else {
                    fractionEl.textContent = '';
                    fractionEl.style.display = 'none';
                }
            }
        });
    };

    // Event Delegation on Activity Matrix Table (Picture 1)
    document.addEventListener('click', function (e) {
        // 1. Click on populated activity card
        var card = e.target.closest('#crm_activity_table .crm-act-card');
        if (card) {
            e.preventDefault();
            e.stopPropagation();
            var leadId = card.getAttribute('data-lead-id');
            var activityId = card.getAttribute('data-activity-id');
            if (leadId && activityId) {
                window.openEditActivityModal(leadId, activityId, card);
            }
            return;
        }

        // 2. Click on empty cell to schedule
        var emptyCell = e.target.closest('#crm_activity_table .crm-act-cell-empty, #crm_activity_table .crm-act-matrix-cell:empty');
        if (emptyCell) {
            e.preventDefault();
            e.stopPropagation();
            var leadId = emptyCell.getAttribute('data-lead-id') || (emptyCell.closest('td') ? emptyCell.closest('td').getAttribute('data-lead-id') : null);
            var typeId = emptyCell.getAttribute('data-type-id') || (emptyCell.closest('td') ? emptyCell.closest('td').getAttribute('data-type-id') : null);
            if (leadId) {
                var defaultData = typeId ? { activity_type_id: parseInt(typeId, 10) } : null;
                openScheduleActivityModal(leadId, defaultData, emptyCell);
            }
            return;
        }

        // 3. Click on + Schedule activity bottom button
        var bottomBtn = e.target.closest('#crm_act_bottom_schedule_btn');
        if (bottomBtn) {
            e.preventDefault();
            e.stopPropagation();
            var visibleRows = document.querySelectorAll('#crm_activity_table tr.crm-activity-lead-row:not([style*="display: none"])');
            var targetLeadId = visibleRows.length > 0 ? visibleRows[0].getAttribute('data-lead-id') : null;
            if (!targetLeadId) {
                var firstRow = document.querySelector('#crm_activity_table tr.crm-activity-lead-row');
                targetLeadId = firstRow ? firstRow.getAttribute('data-lead-id') : null;
            }
            if (targetLeadId) {
                openScheduleActivityModal(targetLeadId, null, bottomBtn);
            }
            return;
        }
    });

    // Run header stats update when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            if (window.updateCrmActivityHeaderStats) {
                setTimeout(window.updateCrmActivityHeaderStats, 100);
            }
        });
    } else {
        setTimeout(window.updateCrmActivityHeaderStats, 100);
    }

})();
