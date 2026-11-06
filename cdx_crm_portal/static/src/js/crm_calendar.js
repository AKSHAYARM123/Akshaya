/* @odoo-module ignore */
/**
 * CRM Portal: Meeting Calendar & Event Scheduling
 * Implements Odoo backend-like interactive meeting calendar,
 * Day / Week / Month timeline views, navigation (<, >, Today),
 * "New Event" popover dialog, and interactive "Meeting Details" wizard
 * matching Odoo backend design (Picture 2).
 */

(function () {
    'use strict';

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async function jsonRpc(url, params) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: params || {},
                }),
            });
            const data = await resp.json();
            if (data.error) {
                console.error('JSON-RPC Error:', data.error);
                return { error: data.error.data ? data.error.data.message : data.error.message };
            }
            return data.result || {};
        } catch (err) {
            console.error('Network Error:', err);
            return { error: err.message };
        }
    }

    let activeCalendarModal = null;
    let activeEventPopover = null;
    let activeMeetingDetailWizard = null;

    // Helper functions for dates & times
    function formatTime12h(hours, minutes) {
        var h = hours % 12;
        if (h === 0) h = 12;
        var m = minutes < 10 ? '0' + minutes : minutes;
        var ampm = hours >= 12 ? 'PM' : 'AM';
        return h + ':' + m + ' ' + ampm;
    }

    function formatDateDisplay(d) {
        var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

    function formatWeekRangeDisplay(d) {
        var days = getWeekDays(d);
        var start = days[0];
        var end = days[6];
        var monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (start.getMonth() === end.getMonth()) {
            return start.getDate() + ' – ' + end.getDate() + ' ' + monthsShort[start.getMonth()] + ' ' + start.getFullYear();
        } else {
            return start.getDate() + ' ' + monthsShort[start.getMonth()] + ' – ' + end.getDate() + ' ' + monthsShort[end.getMonth()] + ' ' + end.getFullYear();
        }
    }

    function formatMonthDisplay(d) {
        var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return months[d.getMonth()] + ' ' + d.getFullYear();
    }

    function formatYMD(d) {
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function isSameDay(d1, d2) {
        if (!d1 || !d2) return false;
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    }

    function parseEventDate(str) {
        if (!str) return null;
        var s = String(str).replace(' ', 'T');
        var d = new Date(s);
        if (isNaN(d.getTime())) {
            var parts = String(str).split(' ');
            var ymd = (parts[0] || '').split('-');
            var hms = (parts[1] || '00:00:00').split(':');
            if (ymd.length === 3) {
                d = new Date(parseInt(ymd[0], 10), parseInt(ymd[1], 10) - 1, parseInt(ymd[2], 10),
                             parseInt(hms[0] || 0, 10), parseInt(hms[1] || 0, 10), parseInt(hms[2] || 0, 10));
            }
        }
        return isNaN(d.getTime()) ? null : d;
    }

    function getWeekDays(date) {
        var d = new Date(date);
        var day = d.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
        var diff = (day === 0 ? -6 : 1) - day; // Monday start
        var monday = new Date(d);
        monday.setDate(d.getDate() + diff);
        monday.setHours(0, 0, 0, 0);

        var days = [];
        for (var i = 0; i < 7; i++) {
            var dayDate = new Date(monday);
            dayDate.setDate(monday.getDate() + i);
            days.push(dayDate);
        }
        return days;
    }

    function getMonthCalendarGrid(year, month) {
        var firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
        var startDiff = (firstDay === 0 ? -6 : 1) - firstDay; // Monday start
        var cur = new Date(year, month, 1);
        cur.setDate(1 + startDiff);
        cur.setHours(0, 0, 0, 0);

        var days = [];
        var totalCells = 35;
        var testEnd = new Date(cur);
        testEnd.setDate(cur.getDate() + 34);
        var lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        if (testEnd.getMonth() === month && testEnd.getDate() < lastDayOfMonth) {
            totalCells = 42;
        }

        for (var i = 0; i < totalCells; i++) {
            var cellDate = new Date(cur);
            cellDate.setDate(cur.getDate() + i);
            days.push({
                date: cellDate,
                isCurrentMonth: cellDate.getMonth() === month,
                isToday: isSameDay(cellDate, new Date()),
                dayNum: cellDate.getDate(),
                ymd: formatYMD(cellDate),
            });
        }
        return days;
    }

    function getMiniMonthGrid(year, month) {
        var firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
        var cur = new Date(year, month, 1);
        cur.setDate(1 - firstDay);
        cur.setHours(0, 0, 0, 0);

        var weeks = [];
        var currentWeek = [];

        for (var i = 0; i < 42; i++) {
            var cellDate = new Date(cur);
            cellDate.setDate(cur.getDate() + i);

            currentWeek.push({
                date: cellDate,
                isCurrentMonth: cellDate.getMonth() === month,
                isToday: isSameDay(cellDate, new Date()),
                dayNum: cellDate.getDate(),
                ymd: formatYMD(cellDate),
            });

            if (currentWeek.length === 7) {
                weeks.push(currentWeek);
                currentWeek = [];
                if (cellDate.getMonth() > month || cellDate.getFullYear() > year) {
                    break;
                }
            }
        }
        return weeks;
    }

    function cleanEventNotes(desc) {
        if (!desc) return '';
        var text = String(desc);
        // Remove <div...>...Organized by...</div> block
        text = text.replace(/<div[^>]*>[\s\S]*?Organized by[\s\S]*?<\/div>/gi, '');
        // Replace <br> and </p> with newline
        text = text.replace(/<br\s*[\/]?>/gi, '\n');
        text = text.replace(/<\/p>/gi, '\n');
        // Strip other HTML tags
        text = text.replace(/<[^>]+>/g, '');
        // Decode HTML entities
        var temp = document.createElement('textarea');
        temp.innerHTML = text;
        text = temp.value;
        // Strip plain text "Organized by..." block if any remains
        text = text.replace(/Organized by[\s\S]*$/gi, '').trim();
        return text;
    }

    // =========================================================================
    // 1. OPEN NEW / EDIT EVENT POPOVER (MATCHING PICTURE 3)
    // =========================================================================
    window.openCrmNewEventPopover = function (leadId, leadName, defaultStart, defaultEnd, onEventSaved, existingEvent) {
        if (activeEventPopover) {
            activeEventPopover.remove();
            activeEventPopover = null;
        }

        var isEdit = Boolean(existingEvent && existingEvent.id);
        var modalTitle = isEdit ? 'Edit Event' : 'New Event';

        var startDt = defaultStart ? new Date(defaultStart) : new Date();
        if (!defaultStart) {
            startDt.setMinutes(30);
            startDt.setSeconds(0);
        }
        var endDt = defaultEnd ? new Date(defaultEnd) : new Date(startDt.getTime() + 60 * 60 * 1000);

        var startStr = startDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + formatTime12h(startDt.getHours(), startDt.getMinutes());
        var endStr = formatTime12h(endDt.getHours(), endDt.getMinutes());

        var popoverBackdrop = document.createElement('div');
        popoverBackdrop.className = 'crm-event-popover-backdrop';

        var popover = document.createElement('div');
        popover.className = 'crm-event-popover-dialog';

        var titleVal = isEdit ? existingEvent.name : (leadName || 'Client Meeting');
        var notesVal = isEdit ? cleanEventNotes(existingEvent.description) : '';

        var html = '';
        html += '<div class="crm-event-popover-header">';
        html += '  <div class="crm-event-popover-title">' + escapeHtml(modalTitle) + '</div>';
        html += '  <button type="button" class="crm-cal-close-btn" id="crm_event_close">&times;</button>';
        html += '</div>';

        html += '<div class="crm-event-popover-body">';

        // Subject / Title
        html += '  <div class="crm-event-field-row">';
        html += '    <i class="fa fa-tag crm-event-field-icon"></i>';
        html += '    <input type="text" id="crm_event_name" class="crm-event-name-input" value="' + escapeHtml(titleVal) + '" placeholder="e.g. Client Demo & Discussion">';
        html += '  </div>';

        // Date & Time Range
        html += '  <div class="crm-event-field-row" style="justify-content: space-between;">';
        html += '    <div style="display: flex; align-items: center; gap: 8px;">';
        html += '      <i class="fa fa-clock crm-event-field-icon"></i>';
        html += '      <div class="crm-event-time-display">';
        html += '        <span class="crm-event-time-pill" id="crm_event_start_pill">' + escapeHtml(startStr) + '</span>';
        html += '        <span style="color: #94a3b8;">&rarr;</span>';
        html += '        <span class="crm-event-time-pill" id="crm_event_end_pill">' + escapeHtml(endStr) + '</span>';
        html += '      </div>';
        html += '    </div>';
        html += '    <label style="display: flex; align-items: center; gap: 5px; color: #475569; cursor: pointer; font-size: 12px;">';
        html += '      <input type="checkbox" id="crm_event_allday"' + (isEdit && existingEvent.allday ? ' checked' : '') + '> All day';
        html += '    </label>';
        html += '  </div>';

        // Attendees
        html += '  <div class="crm-event-field-row" style="align-items: flex-start;">';
        html += '    <i class="fa fa-user-friends crm-event-field-icon" style="margin-top: 6px;"></i>';
        html += '    <div class="crm-event-attendees-box" id="crm_event_attendees_box">';
        html += '      <span class="crm-event-attendee-tag" data-attendee="current_user">';
        html += '        <i class="fa fa-user-circle"></i> Mitchell Admin <button type="button" class="crm-event-attendee-tag-remove">&times;</button>';
        html += '      </span>';
        html += '      <span class="crm-event-attendee-tag" data-attendee="lead_partner">';
        html += '        <i class="fa fa-building"></i> Customer <button type="button" class="crm-event-attendee-tag-remove">&times;</button>';
        html += '      </span>';
        html += '    </div>';
        html += '  </div>';

        // Location & Video Call
        html += '  <div class="crm-event-field-row">';
        html += '    <i class="fa fa-map-marker-alt crm-event-field-icon"></i>';
        html += '    <input type="text" id="crm_event_location" class="crm-event-name-input" value="' + escapeHtml(isEdit ? (existingEvent.location || '') : '') + '" style="font-weight: 500; font-size: 12.5px;" placeholder="Location or meeting room">';
        html += '    <button type="button" class="crm-event-video-btn" id="crm_event_video_btn"><i class="fa fa-video"></i> + Video</button>';
        html += '  </div>';

        // Privacy
        html += '  <div class="crm-event-field-row">';
        html += '    <i class="fa fa-lock crm-event-field-icon"></i>';
        html += '    <select id="crm_event_privacy" style="border: none; border-bottom: 1.5px solid #e2e8f0; font-size: 12px; color: #334155; padding: 4px 0; outline: none; flex: 1;">';
        html += '      <option value="public"' + (isEdit && existingEvent.privacy === 'public' ? ' selected' : '') + '>Public (visible to attendees &amp; sales team)</option>';
        html += '      <option value="private"' + (isEdit && existingEvent.privacy === 'private' ? ' selected' : '') + '>Private (only visible to me)</option>';
        html += '    </select>';
        html += '  </div>';

        // Notes
        html += '  <div class="crm-event-field-row" style="align-items: flex-start;">';
        html += '    <i class="fa fa-file-alt crm-event-field-icon" style="margin-top: 6px;"></i>';
        html += '    <textarea id="crm_event_notes" class="crm-event-notes-input" rows="2" placeholder="Add meeting agenda or notes...">' + escapeHtml(notesVal) + '</textarea>';
        html += '  </div>';

        html += '</div>'; // End body

        // Footer buttons
        html += '<div class="crm-event-popover-footer">';
        html += '  <button type="button" class="crm-event-btn-save" id="crm_event_save_btn">Save</button>';
        html += '  <div style="display: flex; gap: 4px;">';
        html += '    <button type="button" class="crm-event-btn-discard" id="crm_event_discard_btn">Discard</button>';
        html += '  </div>';
        html += '</div>';

        popover.innerHTML = html;
        popoverBackdrop.appendChild(popover);

        var container = activeCalendarModal ? activeCalendarModal.querySelector('.crm-cal-modal-dialog') || document.body : document.body;
        container.appendChild(popoverBackdrop);
        activeEventPopover = popoverBackdrop;

        // Video call button click
        var videoBtn = popover.querySelector('#crm_event_video_btn');
        var locationInput = popover.querySelector('#crm_event_location');
        if (videoBtn && locationInput) {
            videoBtn.addEventListener('click', function () {
                var randomRoom = 'crm-meet-' + Math.random().toString(36).substring(2, 8);
                locationInput.value = 'https://meet.jit.si/' + randomRoom;
                videoBtn.style.background = '#dcfce7';
                videoBtn.style.color = '#15803d';
                videoBtn.innerHTML = '<i class="fa fa-check"></i> Video Added';
            });
        }

        // Remove tag attendee buttons
        popover.querySelectorAll('.crm-event-attendee-tag-remove').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var tag = btn.closest('.crm-event-attendee-tag');
                if (tag) tag.remove();
            });
        });

        function closePopover() {
            if (activeEventPopover) {
                activeEventPopover.remove();
                activeEventPopover = null;
            }
        }

        var closeBtn = popover.querySelector('#crm_event_close');
        var discardBtn = popover.querySelector('#crm_event_discard_btn');
        if (closeBtn) closeBtn.addEventListener('click', closePopover);
        if (discardBtn) discardBtn.addEventListener('click', closePopover);

        // Save Button Handler
        var saveBtn = popover.querySelector('#crm_event_save_btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async function () {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';

                var name = (popover.querySelector('#crm_event_name').value || '').trim() || titleVal;
                var allday = popover.querySelector('#crm_event_allday').checked;
                var location = (locationInput ? locationInput.value : '').trim();
                var privacy = popover.querySelector('#crm_event_privacy').value || 'public';
                var notes = (popover.querySelector('#crm_event_notes').value || '').trim();

                var startFormatted = startDt.getFullYear() + '-' +
                    String(startDt.getMonth() + 1).padStart(2, '0') + '-' +
                    String(startDt.getDate()).padStart(2, '0') + ' ' +
                    String(startDt.getHours()).padStart(2, '0') + ':' +
                    String(startDt.getMinutes()).padStart(2, '0') + ':00';

                var endFormatted = endDt.getFullYear() + '-' +
                    String(endDt.getMonth() + 1).padStart(2, '0') + '-' +
                    String(endDt.getDate()).padStart(2, '0') + ' ' +
                    String(endDt.getHours()).padStart(2, '0') + ':' +
                    String(endDt.getMinutes()).padStart(2, '0') + ':00';

                var rpcUrl = isEdit ? '/portal/meeting/update_event' : '/portal/meeting/create_event';
                var rpcParams = {
                    name: name,
                    start: startFormatted,
                    stop: endFormatted,
                    allday: allday,
                    location: location,
                    videocall_location: location.includes('http') ? location : '',
                    description: notes,
                    privacy: privacy,
                };
                if (isEdit) {
                    rpcParams.event_id = existingEvent.id;
                } else {
                    rpcParams.lead_id = parseInt(leadId, 10);
                }

                var res = await jsonRpc(rpcUrl, rpcParams);

                if (res && res.success) {
                    closePopover();
                    if (onEventSaved) {
                        onEventSaved(res);
                    }
                    if (window.refreshActivityMatrixRow) {
                        window.refreshActivityMatrixRow(leadId);
                    }
                    if (window.updateCrmActivityHeaderStats) {
                        window.updateCrmActivityHeaderStats();
                    }
                } else {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save';
                    alert(res.error || 'Failed to save meeting event. Please try again.');
                }
            });
        }
    };

    // =========================================================================
    // 2. OPEN MEETING CALENDAR VIEW MODAL (DAY / WEEK / MONTH)
    // =========================================================================
    window.openCrmMeetingCalendar = async function (leadId, targetDate) {
        if (activeCalendarModal) {
            activeCalendarModal.remove();
            activeCalendarModal = null;
        }

        var leadIdInt = parseInt(leadId, 10);
        var currentSelectedDate = targetDate ? new Date(targetDate) : new Date();
        if (isNaN(currentSelectedDate.getTime())) {
            currentSelectedDate = new Date();
        }
        var miniCalDate = new Date(currentSelectedDate);
        var currentCalView = 'day'; // 'day' | 'week' | 'month'

        var calData = await jsonRpc('/portal/meeting/get_calendar_data', {
            lead_id: leadIdInt,
            target_date: formatYMD(currentSelectedDate),
        });

        if (!calData || calData.error) {
            alert('Unable to load calendar meetings. Please try again.');
            return;
        }

        var leadInfo = calData.lead || { id: leadIdInt, name: 'Lead' };
        var events = calData.events || [];
        var attendees = calData.attendees || [];
        var currentUser = calData.current_user || {};

        var backdrop = document.createElement('div');
        backdrop.className = 'crm-cal-modal-backdrop';

        var dialog = document.createElement('div');
        dialog.className = 'crm-cal-modal-dialog';

        // 1. Top Header & Breadcrumbs
        var html = '';
        html += '<div class="crm-cal-header">';
        html += '  <div class="crm-cal-breadcrumbs">';
        html += '    <a href="/my/leads"><i class="fa fa-home"></i> Pipeline</a>';
        html += '    <span>/</span>';
        html += '    <span style="font-weight: 600; color: #1e293b;">' + escapeHtml(leadInfo.name) + '</span>';
        html += '    <span>/</span>';
        html += '    <span class="crm-cal-breadcrumbs-current">Meetings</span>';
        html += '  </div>';
        html += '  <button type="button" class="crm-cal-close-btn" id="crm_cal_close_btn" title="Close">&times;</button>';
        html += '</div>';

        // 2. Calendar Controls Bar (<, >, Today, Date Label, Day/Week/Month Switchers)
        html += '<div class="crm-cal-controls-bar">';
        html += '  <div class="crm-cal-controls-left">';
        html += '    <button type="button" class="crm-cal-new-btn" id="crm_cal_new_meeting_btn">';
        html += '      <i class="fa fa-plus"></i> New Meeting';
        html += '    </button>';
        html += '    <div class="crm-cal-nav-group">';
        html += '      <button type="button" class="crm-cal-nav-btn" id="crm_cal_prev_day" title="Previous"><i class="fa fa-chevron-left"></i></button>';
        html += '      <button type="button" class="crm-cal-nav-btn" id="crm_cal_next_day" title="Next"><i class="fa fa-chevron-right"></i></button>';
        html += '    </div>';
        html += '    <button type="button" class="crm-cal-today-btn" id="crm_cal_today_btn">Today</button>';
        html += '    <span class="crm-cal-date-label" id="crm_cal_cur_date_label">' + escapeHtml(formatDateDisplay(currentSelectedDate)) + '</span>';
        html += '  </div>';
        html += '  <div class="crm-cal-view-switchers">';
        html += '    <button type="button" class="crm-cal-view-btn active" data-view="day">Day</button>';
        html += '    <button type="button" class="crm-cal-view-btn" data-view="week">Week</button>';
        html += '    <button type="button" class="crm-cal-view-btn" data-view="month">Month</button>';
        html += '  </div>';
        html += '</div>';

        // 3. Workspace: Main Timeline Grid + Right Sidebar
        html += '<div class="crm-cal-workspace">';
        html += '  <div class="crm-cal-timeline-col" id="crm_cal_timeline_col"></div>';

        // Right Sidebar: Mini Calendar + Attendees
        html += '  <div class="crm-cal-sidebar">';
        html += '    <div id="crm_cal_mini_container"></div>';

        // Attendees Section
        html += '    <div class="crm-cal-attendees-section">';
        html += '      <div class="crm-cal-attendees-title"><i class="fa fa-users" style="color: #1e5ba3;"></i> Attendees</div>';
        html += '      <div style="display: flex; flex-direction: column; gap: 6px;">';
        attendees.forEach(function (att) {
            html += '      <label class="crm-cal-attendee-row">';
            html += '        <input type="checkbox" checked="checked" style="accent-color: #1e5ba3;">';
            html += '        <div class="crm-cal-attendee-avatar">';
            if (att.avatar) {
                html += '          <img src="' + escapeHtml(att.avatar) + '" alt="' + escapeHtml(att.name) + '">';
            } else {
                html += '          <span>' + escapeHtml(att.initials) + '</span>';
            }
            html += '        </div>';
            html += '        <span style="font-weight: 500; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(att.name) + '</span>';
            html += '      </label>';
        });
        html += '      </div>';
        html += '      <button type="button" class="btn btn-link p-0 text-decoration-none mt-2 fw-semibold text-start" style="color: #1e5ba3; font-size: 12px;">+ Add Attendees</button>';
        html += '    </div>';

        html += '  </div>'; // End sidebar
        html += '</div>'; // End workspace

        dialog.innerHTML = html;
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        activeCalendarModal = backdrop;

        // Elements
        var timelineCol = dialog.querySelector('#crm_cal_timeline_col');
        var dateLabel = dialog.querySelector('#crm_cal_cur_date_label');
        var viewBtns = dialog.querySelectorAll('.crm-cal-view-btn');
        var miniContainer = dialog.querySelector('#crm_cal_mini_container');

        // =====================================================================
        // MEETING DETAILS POPOVER / WIZARD (MATCHING PICTURE 2)
        // =====================================================================
        function closeMeetingDetailWizard() {
            if (activeMeetingDetailWizard) {
                activeMeetingDetailWizard.remove();
                activeMeetingDetailWizard = null;
            }
        }

        function openCrmMeetingDetailWizard(ev, pillElement) {
            closeMeetingDetailWizard();

            var popBackdrop = document.createElement('div');
            popBackdrop.className = 'crm-meet-popover-backdrop';

            var card = document.createElement('div');
            card.className = 'crm-meet-popover-card';

            var org = ev.organizer || {
                name: 'Mitchell Admin',
                email: 'admin@example.com',
                phone: '+1 555-555-5555',
                avatar: null,
                initials: 'M',
            };

            var dateStr = ev.date_formatted || (ev.start ? new Date(ev.start).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
            var timeDurationStr = (ev.start_time || '') + ' - ' + (ev.stop_time || '') + (ev.duration_str ? ' ' + ev.duration_str : '');

            // Attendees HTML
            var attendeesHtml = '';
            if (ev.attendees && ev.attendees.length > 0) {
                ev.attendees.forEach(function (att) {
                    attendeesHtml += '<span style="display: inline-flex; align-items: center; gap: 5px;">';
                    if (att.avatar) {
                        attendeesHtml += '<img src="' + escapeHtml(att.avatar) + '" style="width: 18px; height: 18px; border-radius: 50%; object-fit: cover;">';
                    } else {
                        attendeesHtml += '<span class="crm-meet-popover-avatar">' + escapeHtml(att.initials || 'U') + '</span>';
                    }
                    attendeesHtml += '<span style="font-size: 12px; color: #334155;">' + escapeHtml(att.name) + '</span>';
                    attendeesHtml += '</span>';
                });
            } else {
                attendeesHtml = '<span>' + escapeHtml(ev.user_display || 'Mitchell Admin') + '</span>';
            }

            var cardHtml = '';
            // Header
            cardHtml += '<div class="crm-meet-popover-header">';
            cardHtml += '  <span class="crm-meet-popover-title">' + escapeHtml(ev.name || 'Meeting') + '</span>';
            cardHtml += '  <button type="button" class="crm-meet-popover-close" id="crm_meet_pop_close" title="Close">&times;</button>';
            cardHtml += '</div>';

            // Body
            cardHtml += '<div class="crm-meet-popover-body">';

            // Date
            cardHtml += '  <div class="crm-meet-popover-row">';
            cardHtml += '    <i class="fa fa-calendar-alt crm-meet-popover-icon"></i>';
            cardHtml += '    <span style="font-weight: 500;">' + escapeHtml(dateStr) + '</span>';
            cardHtml += '  </div>';

            // Time & Duration
            cardHtml += '  <div class="crm-meet-popover-row">';
            cardHtml += '    <i class="fa fa-clock crm-meet-popover-icon"></i>';
            cardHtml += '    <span>' + escapeHtml(timeDurationStr) + '</span>';
            cardHtml += '  </div>';

            // Attendees
            cardHtml += '  <div class="crm-meet-popover-row">';
            cardHtml += '    <i class="fa fa-user-friends crm-meet-popover-icon"></i>';
            cardHtml += '    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">' + attendeesHtml + '</div>';
            cardHtml += '  </div>';

            // Lead
            cardHtml += '  <div class="crm-meet-popover-row">';
            cardHtml += '    <i class="fa fa-link crm-meet-popover-icon"></i>';
            cardHtml += '    <a href="javascript:void(0)" class="crm-meet-popover-lead-link" id="crm_meet_lead_link">' + escapeHtml(ev.lead_name || leadInfo.name || 'Lead') + '</a>';
            cardHtml += '  </div>';

            // Salesperson / Assigned User
            cardHtml += '  <div class="crm-meet-popover-row">';
            cardHtml += '    <i class="fa fa-user crm-meet-popover-icon"></i>';
            cardHtml += '    <span>' + escapeHtml(ev.user_display || (org.name ? org.name : 'Mitchell Admin')) + '</span>';
            cardHtml += '  </div>';

            // Organizer section
            cardHtml += '  <div class="crm-meet-popover-row" style="align-items: flex-start;">';
            cardHtml += '    <i class="fa fa-address-card crm-meet-popover-icon" style="margin-top: 3px;"></i>';
            cardHtml += '    <div class="crm-meet-popover-organizer-box">';
            cardHtml += '      <span class="crm-meet-popover-organizer-title">Organized by</span>';
            cardHtml += '      <span class="crm-meet-popover-organizer-name">' + escapeHtml(org.name || 'Mitchell Admin') + '</span>';
            cardHtml += '      <a href="mailto:' + escapeHtml(org.email || 'admin@example.com') + '" class="crm-meet-popover-organizer-email">' + escapeHtml(org.email || 'admin@example.com') + '</a>';
            cardHtml += '      <span class="crm-meet-popover-organizer-phone">' + escapeHtml(org.phone || '+1 555-555-5555') + '</span>';
            cardHtml += '    </div>';
            cardHtml += '  </div>';

            cardHtml += '</div>'; // End body

            // Footer (Edit & Delete buttons)
            cardHtml += '<div class="crm-meet-popover-footer">';
            cardHtml += '  <button type="button" class="crm-meet-popover-btn-edit" id="crm_meet_pop_edit_btn">Edit</button>';
            cardHtml += '  <button type="button" class="crm-meet-popover-btn-delete" id="crm_meet_pop_del_btn" title="Delete Meeting"><i class="fa fa-trash"></i></button>';
            cardHtml += '</div>';

            // Arrow
            cardHtml += '<div class="crm-meet-popover-arrow" id="crm_meet_pop_arrow"></div>';

            card.innerHTML = cardHtml;
            popBackdrop.appendChild(card);
            dialog.appendChild(popBackdrop);
            activeMeetingDetailWizard = popBackdrop;

            // Compute exact positioning relative to dialog & pill
            var modalRect = dialog.getBoundingClientRect();
            var pillRect = pillElement.getBoundingClientRect();
            var popoverWidth = 350;

            var pillCenterY = pillRect.top + (pillRect.height / 2) - modalRect.top;
            var pillCenterX = pillRect.left + (pillRect.width / 2) - modalRect.left;

            var spaceAbove = pillRect.top - modalRect.top;
            var placeAbove = spaceAbove > 330;

            var cardTop;
            if (placeAbove) {
                card.classList.add('arrow-bottom');
                var cardHeight = card.offsetHeight || 330;
                cardTop = (pillRect.top - modalRect.top) - cardHeight - 12;
            } else {
                card.classList.add('arrow-top');
                cardTop = (pillRect.bottom - modalRect.top) + 12;
            }

            if (cardTop < 12) cardTop = 12;

            var cardLeft = pillCenterX - (popoverWidth / 2);
            if (cardLeft < 16) cardLeft = 16;
            if (cardLeft + popoverWidth > modalRect.width - 16) {
                cardLeft = modalRect.width - popoverWidth - 16;
            }

            card.style.top = cardTop + 'px';
            card.style.left = cardLeft + 'px';

            var arrowEl = card.querySelector('#crm_meet_pop_arrow');
            if (arrowEl) {
                var arrowLeft = pillCenterX - cardLeft;
                arrowLeft = Math.max(20, Math.min(arrowLeft, popoverWidth - 20));
                arrowEl.style.left = arrowLeft + 'px';
            }

            // Close actions
            var closeBtn = card.querySelector('#crm_meet_pop_close');
            if (closeBtn) closeBtn.addEventListener('click', closeMeetingDetailWizard);

            popBackdrop.addEventListener('click', function (e) {
                if (e.target === popBackdrop) {
                    closeMeetingDetailWizard();
                }
            });

            // Edit Action
            var editBtn = card.querySelector('#crm_meet_pop_edit_btn');
            if (editBtn) {
                editBtn.addEventListener('click', function () {
                    closeMeetingDetailWizard();
                    var defStart = parseEventDate(ev.start) || new Date();
                    var defEnd = parseEventDate(ev.stop) || new Date(defStart.getTime() + 60 * 60 * 1000);

                    window.openCrmNewEventPopover(leadIdInt, leadInfo.name, defStart, defEnd, function (updatedRes) {
                        ev.name = updatedRes.name || ev.name;
                        ev.start = updatedRes.start || ev.start;
                        ev.stop = updatedRes.stop || ev.stop;
                        ev.start_time = updatedRes.start_time || ev.start_time;
                        ev.stop_time = updatedRes.stop_time || ev.stop_time;
                        ev.date = updatedRes.date || ev.date;
                        ev.date_formatted = updatedRes.date_formatted || ev.date_formatted;
                        ev.duration_str = updatedRes.duration_str || ev.duration_str;
                        ev.location = updatedRes.location || ev.location;
                        ev.description = updatedRes.description || ev.description;
                        ev.privacy = updatedRes.privacy || ev.privacy;

                        renderCurrentView();
                        renderMiniCalendar();
                    }, ev);
                });
            }

            // Delete Action
            var delBtn = card.querySelector('#crm_meet_pop_del_btn');
            if (delBtn) {
                delBtn.addEventListener('click', async function () {
                    if (confirm('Are you sure you want to delete this meeting: "' + ev.name + '"?')) {
                        delBtn.disabled = true;
                        var res = await jsonRpc('/portal/meeting/delete_event', { event_id: ev.id });
                        if (res && res.success) {
                            closeMeetingDetailWizard();
                            events = events.filter(function (e) { return e.id !== ev.id; });
                            renderCurrentView();
                            renderMiniCalendar();
                            if (window.refreshActivityMatrixRow) window.refreshActivityMatrixRow(leadIdInt);
                            if (window.updateCrmActivityHeaderStats) window.updateCrmActivityHeaderStats();
                        } else {
                            delBtn.disabled = false;
                            alert(res.error || 'Failed to delete meeting');
                        }
                    }
                });
            }
        }

        // =====================================================================
        // VIEW RENDERER 1: DAY VIEW
        // =====================================================================
        function renderDayView() {
            closeMeetingDetailWizard();
            var dayName = currentSelectedDate.toLocaleDateString('en-US', { weekday: 'long' });
            var dayNum = currentSelectedDate.getDate();
            var isToday = isSameDay(currentSelectedDate, new Date());

            var hHtml = '';
            hHtml += '<div class="crm-cal-day-header">';
            hHtml += '  <span>' + escapeHtml(dayName) + '</span>';
            hHtml += '  <span class="crm-cal-day-badge" style="' + (isToday ? 'background: #ef4444;' : 'background: #64748b;') + '">' + dayNum + '</span>';
            hHtml += '</div>';

            hHtml += '<div class="crm-cal-grid-body" id="crm_cal_grid_body">';

            // Red now-line if today
            if (isToday) {
                var now = new Date();
                var hoursSince8 = (now.getHours() - 8) + (now.getMinutes() / 60);
                if (hoursSince8 >= 0 && hoursSince8 <= 11) {
                    var topPx = Math.round(hoursSince8 * 52);
                    hHtml += '<div class="crm-cal-now-line" style="top: ' + topPx + 'px;"><div class="crm-cal-now-dot"></div></div>';
                }
            }

            // Hours 8 AM to 6 PM
            var hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
            hours.forEach(function (h) {
                var label = formatTime12h(h, 0).replace(':00 ', ' ');
                hHtml += '<div class="crm-cal-slot-row" data-hour="' + h + '">';
                hHtml += '  <div class="crm-cal-time-col">' + escapeHtml(label) + '</div>';
                hHtml += '  <div class="crm-cal-content-col" data-hour="' + h + '"></div>';
                hHtml += '</div>';
            });

            hHtml += '</div>';

            timelineCol.innerHTML = hHtml;

            // Render Day Events
            events.forEach(function (ev) {
                var evStart = parseEventDate(ev.start);
                if (!evStart || !isSameDay(evStart, currentSelectedDate)) return;

                var h = evStart.getHours();
                var slotCol = timelineCol.querySelector('.crm-cal-content-col[data-hour="' + h + '"]');
                if (slotCol) {
                    var pill = document.createElement('div');
                    pill.className = 'crm-cal-event-pill';
                    pill.innerHTML = '<div class="crm-cal-event-title">' + escapeHtml(ev.name) + '</div>' +
                        '<div class="crm-cal-event-time"><i class="fa fa-clock"></i> ' +
                        escapeHtml(ev.start_time || '') + ' - ' + escapeHtml(ev.stop_time || '') + '</div>';

                    pill.addEventListener('click', function (e) {
                        e.stopPropagation();
                        openCrmMeetingDetailWizard(ev, pill);
                    });

                    slotCol.appendChild(pill);
                }
            });

            // Click slot row to create event
            timelineCol.querySelectorAll('.crm-cal-slot-row').forEach(function (row) {
                row.addEventListener('click', function (e) {
                    if (e.target.closest('.crm-cal-event-pill')) return;
                    closeMeetingDetailWizard();
                    var h = parseInt(row.getAttribute('data-hour') || '14', 10);
                    var defaultStart = new Date(currentSelectedDate);
                    defaultStart.setHours(h, 0, 0, 0);
                    var defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);

                    window.openCrmNewEventPopover(leadIdInt, leadInfo.name, defaultStart, defaultEnd, function (newEv) {
                        events.push({
                            id: newEv.event_id,
                            name: newEv.name,
                            start: newEv.start,
                            stop: newEv.stop,
                            start_time: formatTime12h(defaultStart.getHours(), defaultStart.getMinutes()),
                            stop_time: formatTime12h(defaultEnd.getHours(), defaultEnd.getMinutes()),
                            date: formatYMD(defaultStart),
                            date_formatted: defaultStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
                            duration_str: '(1 hour)',
                            lead_name: leadInfo.name,
                            organizer: currentUser,
                        });
                        renderCurrentView();
                        renderMiniCalendar();
                    });
                });
            });
        }

        // =====================================================================
        // VIEW RENDERER 2: WEEK VIEW
        // =====================================================================
        function renderWeekView() {
            closeMeetingDetailWizard();
            var weekDays = getWeekDays(currentSelectedDate);
            var daysShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

            var wHtml = '';
            wHtml += '<div class="crm-cal-week-header">';
            wHtml += '  <div class="crm-cal-week-header-time"></div>';
            wHtml += '  <div class="crm-cal-week-header-days">';
            weekDays.forEach(function (d, idx) {
                var isToday = isSameDay(d, new Date());
                wHtml += '  <div class="crm-cal-week-day-th ' + (isToday ? 'today-col' : '') + '">';
                wHtml += '    <span>' + daysShort[idx] + '</span>';
                wHtml += '    <span class="crm-cal-day-badge" style="' + (isToday ? 'background: #ef4444;' : 'background: #64748b;') + '">' + d.getDate() + '</span>';
                wHtml += '  </div>';
            });
            wHtml += '  </div>';
            wHtml += '</div>';

            wHtml += '<div class="crm-cal-grid-body">';
            var hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
            hours.forEach(function (h) {
                var label = formatTime12h(h, 0).replace(':00 ', ' ');
                wHtml += '<div class="crm-cal-week-slot-row" data-hour="' + h + '">';
                wHtml += '  <div class="crm-cal-time-col">' + escapeHtml(label) + '</div>';
                weekDays.forEach(function (d) {
                    var ymd = formatYMD(d);
                    wHtml += '  <div class="crm-cal-week-day-cell" data-date="' + ymd + '" data-hour="' + h + '"></div>';
                });
                wHtml += '</div>';
            });
            wHtml += '</div>';

            timelineCol.innerHTML = wHtml;

            // Render Week Events
            events.forEach(function (ev) {
                var evStart = parseEventDate(ev.start);
                if (!evStart) return;

                var ymd = formatYMD(evStart);
                var h = evStart.getHours();
                var cell = timelineCol.querySelector('.crm-cal-week-day-cell[data-date="' + ymd + '"][data-hour="' + h + '"]');
                if (cell) {
                    var pill = document.createElement('div');
                    pill.className = 'crm-cal-week-event-pill';
                    pill.innerHTML = '<i class="fa fa-calendar-check" style="margin-right: 3px; font-size: 10px;"></i>' +
                        escapeHtml(ev.name) + ' (' + escapeHtml(ev.start_time || '') + ')';

                    pill.addEventListener('click', function (e) {
                        e.stopPropagation();
                        openCrmMeetingDetailWizard(ev, pill);
                    });

                    cell.appendChild(pill);
                }
            });

            // Click cell to create event
            timelineCol.querySelectorAll('.crm-cal-week-day-cell').forEach(function (cell) {
                cell.addEventListener('click', function (e) {
                    if (e.target.closest('.crm-cal-week-event-pill')) return;
                    closeMeetingDetailWizard();
                    var dateStr = cell.getAttribute('data-date');
                    var h = parseInt(cell.getAttribute('data-hour') || '14', 10);
                    var ymdParts = dateStr.split('-');
                    var defaultStart = new Date(parseInt(ymdParts[0], 10), parseInt(ymdParts[1], 10) - 1, parseInt(ymdParts[2], 10), h, 0, 0);
                    var defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);

                    window.openCrmNewEventPopover(leadIdInt, leadInfo.name, defaultStart, defaultEnd, function (newEv) {
                        events.push({
                            id: newEv.event_id,
                            name: newEv.name,
                            start: newEv.start,
                            stop: newEv.stop,
                            start_time: formatTime12h(defaultStart.getHours(), defaultStart.getMinutes()),
                            stop_time: formatTime12h(defaultEnd.getHours(), defaultEnd.getMinutes()),
                            date: formatYMD(defaultStart),
                            date_formatted: defaultStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
                            duration_str: '(1 hour)',
                            lead_name: leadInfo.name,
                            organizer: currentUser,
                        });
                        renderCurrentView();
                        renderMiniCalendar();
                    });
                });
            });
        }

        // =====================================================================
        // VIEW RENDERER 3: MONTH VIEW
        // =====================================================================
        function renderMonthView() {
            closeMeetingDetailWizard();
            var gridDays = getMonthCalendarGrid(currentSelectedDate.getFullYear(), currentSelectedDate.getMonth());
            var daysShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

            var mHtml = '';
            mHtml += '<div class="crm-cal-month-container">';
            mHtml += '  <div class="crm-cal-month-grid">';

            daysShort.forEach(function (name) {
                mHtml += '  <div class="crm-cal-month-th">' + name + '</div>';
            });

            gridDays.forEach(function (cell) {
                var classes = ['crm-cal-month-cell'];
                if (cell.isToday) classes.push('is-today');
                if (!cell.isCurrentMonth) classes.push('other-month');

                mHtml += '  <div class="' + classes.join(' ') + '" data-date="' + cell.ymd + '">';
                mHtml += '    <div class="crm-cal-month-cell-header">';
                mHtml += '      <span class="crm-cal-month-day-num">' + cell.dayNum + '</span>';
                mHtml += '    </div>';
                mHtml += '  </div>';
            });

            mHtml += '  </div>';
            mHtml += '</div>';

            timelineCol.innerHTML = mHtml;

            // Render Month Events
            events.forEach(function (ev) {
                var evStart = parseEventDate(ev.start);
                if (!evStart) return;

                var ymd = formatYMD(evStart);
                var cell = timelineCol.querySelector('.crm-cal-month-cell[data-date="' + ymd + '"]');
                if (cell) {
                    var pill = document.createElement('div');
                    pill.className = 'crm-cal-month-event-pill';
                    pill.innerHTML = '<span style="color: #d97706; font-size: 8px;">●</span> ' +
                        '<span style="font-weight: 500; font-size: 10px; color: #78350f;">' + escapeHtml(ev.start_time || '') + '</span> ' +
                        '<span>' + escapeHtml(ev.name) + '</span>';

                    pill.addEventListener('click', function (e) {
                        e.stopPropagation();
                        openCrmMeetingDetailWizard(ev, pill);
                    });

                    cell.appendChild(pill);
                }
            });

            // Click month cell to create event
            timelineCol.querySelectorAll('.crm-cal-month-cell').forEach(function (cell) {
                cell.addEventListener('click', function (e) {
                    if (e.target.closest('.crm-cal-month-event-pill')) return;
                    closeMeetingDetailWizard();
                    var dateStr = cell.getAttribute('data-date');
                    var ymdParts = dateStr.split('-');
                    var defaultStart = new Date(parseInt(ymdParts[0], 10), parseInt(ymdParts[1], 10) - 1, parseInt(ymdParts[2], 10), 10, 0, 0);
                    var defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);

                    window.openCrmNewEventPopover(leadIdInt, leadInfo.name, defaultStart, defaultEnd, function (newEv) {
                        events.push({
                            id: newEv.event_id,
                            name: newEv.name,
                            start: newEv.start,
                            stop: newEv.stop,
                            start_time: formatTime12h(defaultStart.getHours(), defaultStart.getMinutes()),
                            stop_time: formatTime12h(defaultEnd.getHours(), defaultEnd.getMinutes()),
                            date: formatYMD(defaultStart),
                            date_formatted: defaultStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
                            duration_str: '(1 hour)',
                            lead_name: leadInfo.name,
                            organizer: currentUser,
                        });
                        renderCurrentView();
                        renderMiniCalendar();
                    });
                });
            });
        }

        // =====================================================================
        // VIEW DISPATCHER & CONTROL UPDATE
        // =====================================================================
        function renderCurrentView() {
            closeMeetingDetailWizard();

            // Update top date label
            if (currentCalView === 'day') {
                dateLabel.textContent = formatDateDisplay(currentSelectedDate);
            } else if (currentCalView === 'week') {
                dateLabel.textContent = formatWeekRangeDisplay(currentSelectedDate);
            } else if (currentCalView === 'month') {
                dateLabel.textContent = formatMonthDisplay(currentSelectedDate);
            }

            // Update active state on view switcher buttons
            viewBtns.forEach(function (btn) {
                if (btn.getAttribute('data-view') === currentCalView) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            // Render view body
            if (currentCalView === 'day') {
                renderDayView();
            } else if (currentCalView === 'week') {
                renderWeekView();
            } else if (currentCalView === 'month') {
                renderMonthView();
            }
        }

        // =====================================================================
        // SIDEBAR MINI CALENDAR
        // =====================================================================
        function renderMiniCalendar() {
            var year = miniCalDate.getFullYear();
            var month = miniCalDate.getMonth();
            var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            var weeks = getMiniMonthGrid(year, month);

            var sHtml = '';
            sHtml += '<div class="crm-cal-mini-header">';
            sHtml += '  <span style="font-weight: 700;">' + months[month] + ' ' + year + '</span>';
            sHtml += '  <div style="display: flex; gap: 8px; color: #64748b;">';
            sHtml += '    <i class="fa fa-chevron-left" id="crm_cal_mini_prev" style="cursor: pointer; padding: 2px 4px;" title="Previous Month"></i>';
            sHtml += '    <i class="fa fa-chevron-right" id="crm_cal_mini_next" style="cursor: pointer; padding: 2px 4px;" title="Next Month"></i>';
            sHtml += '  </div>';
            sHtml += '</div>';

            sHtml += '<table class="crm-cal-mini-table">';
            sHtml += '  <thead><tr><th>S</th><th>M</th><th>T</th><th>W</th><th>T</th><th>F</th><th>S</th></tr></thead>';
            sHtml += '  <tbody>';

            weeks.forEach(function (week) {
                sHtml += '<tr>';
                week.forEach(function (c) {
                    var isSelected = isSameDay(c.date, currentSelectedDate);
                    var cls = [];
                    if (c.isToday) {
                        cls.push('today-cell');
                    } else if (isSelected) {
                        cls.push('selected-cell');
                    }
                    if (!c.isCurrentMonth) {
                        cls.push('other-month');
                    }
                    sHtml += '<td class="' + cls.join(' ') + '" data-date="' + c.ymd + '">' + c.dayNum + '</td>';
                });
                sHtml += '</tr>';
            });

            sHtml += '  </tbody>';
            sHtml += '</table>';

            miniContainer.innerHTML = sHtml;

            // Mini Calendar Prev/Next month handlers
            var prevMini = miniContainer.querySelector('#crm_cal_mini_prev');
            var nextMini = miniContainer.querySelector('#crm_cal_mini_next');
            if (prevMini) {
                prevMini.addEventListener('click', function () {
                    miniCalDate.setMonth(miniCalDate.getMonth() - 1);
                    renderMiniCalendar();
                });
            }
            if (nextMini) {
                nextMini.addEventListener('click', function () {
                    miniCalDate.setMonth(miniCalDate.getMonth() + 1);
                    renderMiniCalendar();
                });
            }

            // Click date in mini calendar
            miniContainer.querySelectorAll('td[data-date]').forEach(function (td) {
                td.addEventListener('click', function () {
                    var ymdParts = td.getAttribute('data-date').split('-');
                    currentSelectedDate = new Date(parseInt(ymdParts[0], 10), parseInt(ymdParts[1], 10) - 1, parseInt(ymdParts[2], 10));
                    miniCalDate = new Date(currentSelectedDate);
                    renderMiniCalendar();
                    renderCurrentView();
                });
            });
        }

        // =====================================================================
        // CONTROLS BAR EVENT LISTENERS (<, >, Today, Day, Week, Month)
        // =====================================================================

        // Previous (<) Button
        var prevBtn = dialog.querySelector('#crm_cal_prev_day');
        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                if (currentCalView === 'day') {
                    currentSelectedDate.setDate(currentSelectedDate.getDate() - 1);
                } else if (currentCalView === 'week') {
                    currentSelectedDate.setDate(currentSelectedDate.getDate() - 7);
                } else if (currentCalView === 'month') {
                    currentSelectedDate.setMonth(currentSelectedDate.getMonth() - 1);
                }
                miniCalDate = new Date(currentSelectedDate);
                renderCurrentView();
                renderMiniCalendar();
            });
        }

        // Next (>) Button
        var nextBtn = dialog.querySelector('#crm_cal_next_day');
        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                if (currentCalView === 'day') {
                    currentSelectedDate.setDate(currentSelectedDate.getDate() + 1);
                } else if (currentCalView === 'week') {
                    currentSelectedDate.setDate(currentSelectedDate.getDate() + 7);
                } else if (currentCalView === 'month') {
                    currentSelectedDate.setMonth(currentSelectedDate.getMonth() + 1);
                }
                miniCalDate = new Date(currentSelectedDate);
                renderCurrentView();
                renderMiniCalendar();
            });
        }

        // Today Button
        var todayBtn = dialog.querySelector('#crm_cal_today_btn');
        if (todayBtn) {
            todayBtn.addEventListener('click', function () {
                currentSelectedDate = new Date();
                miniCalDate = new Date(currentSelectedDate);
                renderCurrentView();
                renderMiniCalendar();
            });
        }

        // View Switchers (Day, Week, Month)
        viewBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var v = btn.getAttribute('data-view');
                if (v && v !== currentCalView) {
                    currentCalView = v;
                    renderCurrentView();
                }
            });
        });

        // "+ New Meeting" Button
        var newMeetBtn = dialog.querySelector('#crm_cal_new_meeting_btn');
        if (newMeetBtn) {
            newMeetBtn.addEventListener('click', function () {
                closeMeetingDetailWizard();
                var defStart = new Date(currentSelectedDate);
                defStart.setHours(14, 0, 0, 0);
                var defEnd = new Date(defStart.getTime() + 60 * 60 * 1000);

                window.openCrmNewEventPopover(leadIdInt, leadInfo.name, defStart, defEnd, function (newEv) {
                    events.push({
                        id: newEv.event_id,
                        name: newEv.name,
                        start: newEv.start,
                        stop: newEv.stop,
                        start_time: '02:00 PM',
                        stop_time: '03:00 PM',
                        date: formatYMD(defStart),
                        date_formatted: defStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
                        duration_str: '(1 hour)',
                        lead_name: leadInfo.name,
                        organizer: currentUser,
                    });
                    renderCurrentView();
                    renderMiniCalendar();
                });
            });
        }

        // Close handlers
        var closeBtn = dialog.querySelector('#crm_cal_close_btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                closeMeetingDetailWizard();
                backdrop.remove();
                activeCalendarModal = null;
            });
        }
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) {
                closeMeetingDetailWizard();
                backdrop.remove();
                activeCalendarModal = null;
            }
        });

        // Initial render
        renderCurrentView();
        renderMiniCalendar();
    };

})();
