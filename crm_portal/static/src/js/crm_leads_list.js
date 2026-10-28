/* @odoo-module ignore */
/**
 * CRM Portal: Leads List Interaction
 * Handles New Lead modal toggle, priority stars, bulk checkbox selection, and client-side table search.
 */
// Global Priority Setting Helper to ensure priority stars can always be clicked and updated
window.setLeadPriorityManual = function (starEl, val, leadId) {
    if (!starEl) return;
    val = parseInt(val) || 0;
    var now = Date.now();
    if (starEl._crm_last_click && (now - starEl._crm_last_click < 400)) {
        return;
    }
    starEl._crm_last_click = now;

    if (!leadId) {
        leadId = starEl.getAttribute('data-lead-id') ||
                 (starEl.closest('[data-lead-id]') ? starEl.closest('[data-lead-id]').getAttribute('data-lead-id') : null);
    }

    var container = starEl.closest('form') || starEl.closest('.modal-content') || starEl.closest('.crm-mockup-container') || starEl.closest('.crm-kanban-card') || starEl.closest('tr') || document;
    var inp = container.querySelector ? container.querySelector('input[name="priority"]') : null;
    if (!inp) {
        inp = document.getElementById('crm_lead_priority_input_field') ||
              document.getElementById('crm_lead_priority_input') ||
              document.querySelector('.crm-quick-priority-val');
    }

    var currentVal = 0;
    if (starEl.hasAttribute('data-current-val')) {
        currentVal = parseInt(starEl.getAttribute('data-current-val'), 10) || 0;
    } else if (inp) {
        currentVal = parseInt(inp.value, 10) || 0;
    } else {
        var parentStars = starEl.parentElement ? starEl.parentElement.querySelectorAll('.crm-star-select, .crm-star-opt, .crm-star-card-opt') : [];
        var activeCount = 0;
        parentStars.forEach(function (st) {
            if (st.textContent.trim() === '★' || st.classList.contains('star-filled')) activeCount++;
        });
        currentVal = activeCount;
    }

    var newVal = (currentVal === val) ? 0 : val;

    if (inp) {
        inp.value = String(newVal);
        inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (container && container.querySelectorAll) {
        container.querySelectorAll('input[name="priority"]').forEach(function (i) {
            i.value = String(newVal);
        });
    }

    var parent = starEl.parentElement;
    if (parent) {
        var stars = parent.querySelectorAll('.crm-star-select, .crm-star-opt, .crm-star-card-opt');
        stars.forEach(function (st) {
            st.setAttribute('data-current-val', String(newVal));
            var sVal = parseInt(st.getAttribute('data-val'), 10) || 0;
            var active = (newVal >= sVal && newVal > 0);
            st.textContent = active ? '★' : '☆';
            st.style.color = active ? '#f59e0b' : '#cbd5e1';
        });
    }

    // Persist via RPC if leadId is present
    if (leadId) {
        fetch('/my/leads/' + leadId + '/priority', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: {
                    priority: String(newVal)
                }
            })
        }).catch(function (err) {
            console.warn('Failed to update priority:', err);
        });
    }
};

function initLeadsList() {
    // Lost leads & opportunities instant search filter (Picture 3)
    const lostInput = document.getElementById('crm_lost_search_input');
    if (lostInput) {
        lostInput.addEventListener('input', function () {
            const q = lostInput.value.toLowerCase().trim();
            const rows = document.querySelectorAll('.crm-lost-row');
            let vis = 0;
            let rev = 0;
            rows.forEach(function (r) {
                const txt = r.getAttribute('data-search') || '';
                const match = (!q || txt.indexOf(q) !== -1);
                r.style.display = match ? '' : 'none';
                if (match) {
                    vis++;
                }
            });
            const badge = document.getElementById('crm_lost_badge_count');
            if (badge) badge.textContent = vis;
            const countEl = document.getElementById('crm_lost_footer_count');
            if (countEl) {
                countEl.textContent = vis > 0 ? ('1-' + vis + ' of ' + vis) : '0 of 0';
            }
            const noRow = document.getElementById('crm_lost_no_records_row');
            if (noRow) {
                noRow.style.display = (vis === 0 && rows.length > 0) ? '' : 'none';
            }
        });
    }

    if (window.__crm_leads_list_initialized) return;
    window.__crm_leads_list_initialized = true;

    // Modal open/close for New Lead
    const btnToggle = document.getElementById('btn_toggle_create_lead');
    const createModal = document.getElementById('crm_create_lead_modal');
    const btnClose = document.getElementById('crm_close_create_card');
    const btnCancel = document.getElementById('crm_cancel_create_card');

    function openCreateModal() {
        if (createModal) {
            createModal.style.display = 'flex';
            const priorityInput = document.getElementById('crm_lead_priority_input');
            const starsContainer = document.getElementById('crm_lead_stars_container');
            if (priorityInput) priorityInput.value = '0';
            if (starsContainer) {
                const stars = starsContainer.querySelectorAll('.crm-star-select');
                stars.forEach(function (s) {
                    s.textContent = '☆';
                    s.style.color = '#cbd5e1';
                });
            }
            const firstInput = createModal.querySelector('input[name="name"]') || createModal.querySelector('input[name="company_name"]');
            if (firstInput) firstInput.focus();
        }
    }

    function closeCreateModal() {
        if (createModal) {
            createModal.style.display = 'none';
        }
    }

    if (btnToggle) {
        btnToggle.addEventListener('click', function (e) {
            e.preventDefault();
            openCreateModal();
        });
    }
    if (btnClose) btnClose.addEventListener('click', closeCreateModal);
    if (btnCancel) btnCancel.addEventListener('click', closeCreateModal);

    if (createModal) {
        createModal.addEventListener('click', function (e) {
            if (e.target === createModal) {
                closeCreateModal();
            }
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (createModal && createModal.style.display !== 'none') {
                closeCreateModal();
            }
        }
    });

    // Priority stars unified function
    window.setLeadModalPriority = function (val) {
        const star = document.querySelector('#crm_lead_stars_container .crm-star-select[data-val="' + val + '"]');
        if (star && window.setLeadPriorityManual) {
            window.setLeadPriorityManual(star, val);
        }
    };

    // Priority star click delegation
    document.addEventListener('click', function (e) {
        const star = e.target.closest('.crm-star-select, .crm-star-opt, .crm-star-card-opt');
        if (!star) return;
        const container = star.closest('.crm-quick-stars, #crm_lead_stars_container, .crm-priority-stars, .crm-stars-wrapper');
        if (!container) return;
        e.preventDefault();
        e.stopPropagation();
        const clickedVal = parseInt(star.getAttribute('data-val') || '0', 10);
        const leadId = star.getAttribute('data-lead-id') || (star.closest('[data-lead-id]') ? star.closest('[data-lead-id]').getAttribute('data-lead-id') : null);
        if (window.setLeadPriorityManual) {
            window.setLeadPriorityManual(star, clickedVal, leadId);
        }
    });

    // Checkbox selection & bulk convert
    const masterCheckbox = document.getElementById('crm_select_all_leads');
    const leadCheckboxes = document.querySelectorAll('.crm-lead-checkbox');
    const bulkConvertBtn = document.getElementById('btn_bulk_convert');
    const selectedCountSpan = document.getElementById('selected_leads_count');
    const hiddenIdsInput = document.getElementById('crm_selected_lead_ids');

    function updateSelection() {
        const selectedIds = [];
        leadCheckboxes.forEach(function (cb) {
            if (cb.checked) {
                selectedIds.push(cb.value);
            }
        });

        if (selectedCountSpan) selectedCountSpan.textContent = selectedIds.length;
        if (hiddenIdsInput) hiddenIdsInput.value = selectedIds.join(',');

        if (bulkConvertBtn) {
            if (selectedIds.length > 0) {
                bulkConvertBtn.classList.remove('disabled');
                bulkConvertBtn.removeAttribute('disabled');
            } else {
                bulkConvertBtn.classList.add('disabled');
                bulkConvertBtn.setAttribute('disabled', 'disabled');
            }
        }

        if (masterCheckbox) {
            let allSelected = false;
            if (selectedIds.length > 0 && selectedIds.length === leadCheckboxes.length) {
                allSelected = true;
            }
            masterCheckbox.checked = allSelected;
        }
    }

    if (masterCheckbox) {
        masterCheckbox.addEventListener('change', function () {
            const isChecked = masterCheckbox.checked;
            leadCheckboxes.forEach(function (cb) {
                const row = cb.closest('.crm-lead-row');
                if (!row || row.style.display !== 'none') {
                    cb.checked = isChecked;
                }
            });
            updateSelection();
        });
    }

    leadCheckboxes.forEach(function (cb) {
        cb.addEventListener('change', updateSelection);
    });


    // Check overdue on date cells
    const todayStr = new Date().toISOString().slice(0, 10);
    document.querySelectorAll('#crm_leads_table .crm-closing-date-normal').forEach(function (el) {
        const dl = el.getAttribute('data-deadline');
        const row = el.closest('tr');
        const stagePill = row ? row.querySelector('.crm-stage-pill') : null;
        const isWon = stagePill && stagePill.classList.contains('crm-stage-won');
        if (dl && dl < todayStr && !isWon) {
            el.className = 'crm-closing-date-overdue';
            if (!el.querySelector('i.fa-clock-o')) {
                el.innerHTML = '<i class="fa fa-clock-o"></i> <span>' + el.textContent.trim() + '</span>';
            }
        }
    });

    // Search input filter
    const searchInput = document.getElementById('crm_leads_search_input');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            const q = searchInput.value.toLowerCase().trim();
            const rows = document.querySelectorAll('.crm-lead-row');
            rows.forEach(function (row) {
                const s = row.getAttribute('data-search') || '';
                row.style.display = (!q || s.indexOf(q) !== -1) ? '' : 'none';
            });
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLeadsList);
} else {
    initLeadsList();
}
