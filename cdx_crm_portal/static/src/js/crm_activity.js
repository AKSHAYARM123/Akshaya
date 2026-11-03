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

        var types = initData.types || [];
        var users = initData.users || [];
        var currentUser = initData.current_user || {};

        var isEditing = !!(activityData && activityData.id);

        // Preselected values
        var selectedTypeId = isEditing ? activityData.activity_type_id : (types.length > 0 ? types[0].id : null);
        var initialSummary = isEditing ? (activityData.summary || '') : (types.length > 0 ? (types[0].default_summary || types[0].name) : '');
        var initialDate = isEditing ? (activityData.date_deadline || getTodayDateStr()) : getTodayDateStr();
        var initialUserId = isEditing ? (activityData.user_id || currentUser.id) : (currentUser.id || (users.length > 0 ? users[0].id : null));
        var initialNote = isEditing ? (activityData.note || '') : '';

        // Assigned user: always show logged-in user as requested ("arano login chyth ayalde name mathrm kanichal mthy")
        var assignedUser = users.find(function (u) { return u.id === initialUserId; }) || currentUser;
        var loggedInUser = (currentUser && currentUser.id) ? currentUser : (assignedUser || {});
        var displayUserId = loggedInUser.id || initialUserId || null;
        var displayName = loggedInUser.name || 'User';
        var displayInitials = loggedInUser.initials || 'U';

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

        // Activity Type selection pills (Matching Picture 2)
        html += '  <div class="crm-act-type-pills">';
        types.forEach(function (t) {
            var isActive = (t.id === selectedTypeId);
            var activeCls = isActive ? ' active' : '';
            var iconHtml = isActive ? '<i class="fa fa-check"></i>' : ('<i class="fa ' + escapeHtml(t.icon || 'fa-tasks') + '"></i>');
            html += '    <button type="button" class="crm-act-type-pill' + activeCls + '" data-type-id="' + t.id + '" data-default-summary="' + escapeHtml(t.default_summary || t.name) + '" data-icon="' + escapeHtml(t.icon || 'fa-tasks') + '">';
            html += '      ' + iconHtml + ' <span>' + escapeHtml(t.name) + '</span>';
            html += '    </button>';
        });
        html += '  </div>';

        // Fields: Summary, Due Date, Assigned to, Log a note... (Matching Picture 2)
        html += '  <div class="crm-act-field-row">';
        html += '    <label class="crm-act-field-label">Summary</label>';
        html += '    <div class="crm-act-field-control">';
        html += '      <input type="text" id="crm_act_summary_input" class="crm-act-text-input" value="' + escapeHtml(initialSummary) + '" placeholder="Summary">';
        html += '    </div>';
        html += '  </div>';

        html += '  <div class="crm-act-field-row">';
        html += '    <label class="crm-act-field-label">Due Date</label>';
        html += '    <div class="crm-act-field-control">';
        html += '      <input type="date" id="crm_act_date_input" class="crm-act-text-input" value="' + escapeHtml(initialDate) + '">';
        html += '    </div>';
        html += '  </div>';

        html += '  <div class="crm-act-field-row crm-act-field-row-user">';
        html += '    <label class="crm-act-field-label">Assigned to</label>';
        html += '    <div class="crm-act-field-control">';
        html += '      <div class="crm-act-user-wrapper">';
        html += '        <span id="crm_act_user_avatar" class="crm-act-user-avatar-pill">' + escapeHtml(displayInitials) + '</span>';
        html += '        <span id="crm_act_user_name" class="crm-act-user-name-text">' + escapeHtml(displayName) + '</span>';
        html += '        <input type="hidden" id="crm_act_user_id" value="' + escapeHtml(displayUserId) + '">';
        html += '      </div>';
        html += '    </div>';
        html += '  </div>';

        // Log a note row (Matching Picture 2: clean input with placeholder and underline)
        html += '  <div class="crm-act-note-row">';
        html += '    <div id="crm_act_note_input" class="crm-act-note-input" contenteditable="true" data-placeholder="Log a note..." role="textbox" aria-multiline="true"></div>';
        html += '  </div>';

        html += '</div>'; // End body

        // 3. Footer Buttons (Matching Picture 2: Blue Save, Mark Done, Discard)
        html += '<div class="crm-act-dialog-footer">';
        html += '  <button type="button" class="crm-act-btn-save">Save</button>';
        html += '  <button type="button" class="crm-act-btn-done">Mark Done</button>';
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

                // If summary matches another default or is blank, update to new default
                var currentVal = summaryInput.value.trim();
                var isDefault = !currentVal || types.some(function (t) { return t.name === currentVal || t.default_summary === currentVal; });
                if (isDefault) {
                    summaryInput.value = defSummary;
                }
            });
        });

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

    // Direct edit handler when clicking an activity icon on a lead card
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

})();
