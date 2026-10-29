/* @odoo-module ignore */
/**
 * CRM Portal: Pipeline & Kanban Interaction
 * Handles drag-and-drop between stages, filtering (Pipeline / Leads / Stage / Date / User),
 * view mode switching (Kanban vs List), quick-create cards, and lead generation modal.
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

function initCrmPipeline() {
    if (window.__crm_pipeline_initialized) return;
    window.__crm_pipeline_initialized = true;
    console.log("[CRM Portal] Initializing Pipeline & Drag-and-Drop...");
    let draggedLead = null;

    /* ----------------------------------------------------- */
    /* NEW BUTTON and QUICK CREATE IN STAGES                 */
    /* ----------------------------------------------------- */
    const allQuickCreates = document.querySelectorAll('#crm_kanban_view .crm-quick-create-card');

    // Column Header '+' buttons (Toggles inline quick create card from Picture 2)
    document.querySelectorAll('.crm-stage-add-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const stageId = btn.getAttribute('data-stage-id');
            const targetQuick = document.getElementById('crm_quick_create_' + stageId);
            if (targetQuick) {
                const isHidden = targetQuick.style.display === 'none' || !targetQuick.style.display;
                allQuickCreates.forEach(q => q.style.display = 'none');
                targetQuick.style.display = isHidden ? 'block' : 'none';
                if (isHidden) {
                    const input = targetQuick.querySelector('input[name="company_name"]') || targetQuick.querySelector('input[name="name"]');
                    if (input) setTimeout(() => input.focus(), 50);
                }
            }
        });
    });

    // Quick Create close and cancel buttons
    document.querySelectorAll('.crm-quick-cancel-btn, .crm-quick-close-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const card = btn.closest('.crm-quick-create-card');
            if (card) {
                card.style.display = 'none';
                const form = card.querySelector('form');
                if (form) form.reset();
            }
        });
    });

    // Priority star selector (Kanban stage quick-create and modals)
    document.addEventListener('click', function (e) {
        const star = e.target.closest('.crm-star-select, .crm-star-opt');
        if (!star) return;

        const container = star.closest('.crm-quick-stars, #crm_lead_stars_container, .crm-priority-stars, .crm-stars-wrapper');
        if (!container) return;

        e.preventDefault();
        e.stopPropagation();

        const clickedVal = parseInt(star.getAttribute('data-val') || '0', 10);
        if (window.setLeadPriorityManual) {
            window.setLeadPriorityManual(star, clickedVal);
        }
    });

    /* ----------------------------------------------------- */
    /* GENERATE LEADS MODAL                                  */
    /* ----------------------------------------------------- */
    const generateBtn = document.getElementById('crm_generate_leads_button');
    const generateModal = document.getElementById('crm_generate_leads_modal');
    const generateClose = document.getElementById('crm_generate_close');
    const generateCancel = document.getElementById('crm_generate_cancel');

    function closeGenerateModal() {
        if (generateModal) generateModal.style.display = 'none';
    }

    if (generateBtn && generateModal) {
        generateBtn.addEventListener('click', function () {
            generateModal.style.display = 'flex';
        });
    }
    if (generateClose) generateClose.addEventListener('click', closeGenerateModal);
    if (generateCancel) generateCancel.addEventListener('click', closeGenerateModal);
    if (generateModal) {
        generateModal.addEventListener('click', function (e) {
            if (e.target === generateModal || e.target.classList.contains('crm-generate-overlay')) {
                closeGenerateModal();
            }
        });
    }

    /* ----------------------------------------------------- */
    /* ----------------------------------------------------- */
    /* NEW LEAD / OPPORTUNITY POPUP MODAL (WIZARD)           */
    /* ----------------------------------------------------- */
    const btnToggleLead = document.getElementById('btn_toggle_create_lead');
    const btnNewOpp = document.getElementById('btn_new_opportunity');
    const btnNewLead = document.getElementById('btn_new_lead');
    const createLeadModal = document.getElementById('crm_create_lead_modal');
    const btnCloseLead = document.getElementById('crm_close_create_card');
    const btnCancelLead = document.getElementById('crm_cancel_create_card');

    function openCreateLeadModal() {
        if (createLeadModal) {
            createLeadModal.style.display = 'flex';
            const firstInput = createLeadModal.querySelector('input[name="name"]') || createLeadModal.querySelector('input[name="company_name"]');
            if (firstInput) firstInput.focus();
        }
    }

    function closeCreateLeadModal() {
        if (createLeadModal) {
            createLeadModal.style.display = 'none';
        }
    }

    function openModalFor(mode, stageId) {
        if (!createLeadModal) return;

        const isOpp = (mode === 'opportunity');
        const oppSection = document.getElementById('crm_modal_fields_opportunity');
        const leadSection = document.getElementById('crm_modal_fields_lead');
        const modalTitle = document.getElementById('crm_create_modal_title') || createLeadModal.querySelector('h6');
        const modalTypeInput = document.getElementById('crm_create_lead_type');
        const modalForm = document.getElementById('crm_leads_create_form');
        const modalRedirect = document.getElementById('crm_create_lead_redirect');
        const modalPriorityInput = document.getElementById('crm_lead_priority_input');
        const modalStageInput = document.getElementById('crm_create_lead_stage_id');

        if (modalTitle) {
            modalTitle.textContent = isOpp ? 'New Opportunity' : 'New Lead';
        }
        if (modalTypeInput) {
            modalTypeInput.value = isOpp ? 'opportunity' : 'lead';
        }
        if (modalForm) {
            modalForm.action = '/my/leads/quick-create';
        }
        if (modalRedirect) {
            modalRedirect.value = isOpp ? '/my/leads' : '/my/leads?type=lead&view=kanban';
        }
        if (modalStageInput) {
            modalStageInput.value = stageId || '';
        }
        if (modalPriorityInput) {
            modalPriorityInput.value = '0';
        }

        // Toggle sections and enable only active section inputs
        if (oppSection && leadSection) {
            if (isOpp) {
                oppSection.style.display = 'block';
                leadSection.style.display = 'none';
                oppSection.querySelectorAll('input, select, textarea').forEach(el => el.disabled = false);
                leadSection.querySelectorAll('input, select, textarea').forEach(el => el.disabled = true);
                const firstInput = oppSection.querySelector('input[name="name"]');
                if (firstInput) setTimeout(() => firstInput.focus(), 50);
            } else {
                oppSection.style.display = 'none';
                leadSection.style.display = 'block';
                oppSection.querySelectorAll('input, select, textarea').forEach(el => el.disabled = true);
                leadSection.querySelectorAll('input, select, textarea').forEach(el => el.disabled = false);
                const firstInput = leadSection.querySelector('input[name="name"]');
                if (firstInput) setTimeout(() => firstInput.focus(), 50);
            }
        }

        // Reset priority stars
        createLeadModal.querySelectorAll('.crm-star-select').forEach(function (s) {
            s.textContent = '☆';
            s.style.color = '#cbd5e1';
        });

        openCreateLeadModal();
    }

    // Auto-fill Opportunity contact details when partner is selected
    const oppPartnerSelect = document.getElementById('crm_opp_partner_id');
    if (oppPartnerSelect) {
        oppPartnerSelect.addEventListener('change', function () {
            const opt = oppPartnerSelect.options[oppPartnerSelect.selectedIndex];
            if (opt) {
                const emailInput = document.getElementById('crm_opp_email');
                const phoneInput = document.getElementById('crm_opp_phone');
                if (emailInput && opt.getAttribute('data-email')) {
                    emailInput.value = opt.getAttribute('data-email');
                }
                if (phoneInput && opt.getAttribute('data-phone')) {
                    phoneInput.value = opt.getAttribute('data-phone');
                }
            }
        });
    }

    // Attach click events to open popup wizard directly
    if (btnNewOpp) {
        btnNewOpp.addEventListener('click', function (e) {
            e.preventDefault();
            openModalFor('opportunity');
        });
    }

    if (btnNewLead) {
        btnNewLead.addEventListener('click', function (e) {
            e.preventDefault();
            openModalFor('lead');
        });
    }

    if (btnToggleLead) {
        btnToggleLead.addEventListener('click', function (e) {
            e.preventDefault();
            openModalFor(currentMode);
        });
    }


    if (btnCloseLead) btnCloseLead.addEventListener('click', closeCreateLeadModal);
    if (btnCancelLead) btnCancelLead.addEventListener('click', closeCreateLeadModal);

    if (createLeadModal) {
        createLeadModal.addEventListener('click', function (e) {
            if (e.target === createLeadModal) {
                closeCreateLeadModal();
            }
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (createLeadModal && createLeadModal.style.display !== 'none') {
                closeCreateLeadModal();
            }
        }
    });

    // Global function to set priority in create modal
    window.setLeadModalPriority = function (val) {
        val = parseInt(val, 10) || 0;
        const form = document.getElementById('crm_leads_create_form');
        const priorityInput = document.getElementById('crm_lead_priority_input') || (form ? (form.querySelector('.crm-quick-priority-val') || form.querySelector('input[name="priority"]')) : null);
        const currentVal = priorityInput ? (parseInt(priorityInput.value || '0', 10) || 0) : 0;
        const newVal = (currentVal === val) ? 0 : val;

        document.querySelectorAll('#crm_lead_priority_input, .crm-quick-priority-val').forEach(function (inp) {
            if (inp.closest('#crm_create_lead_modal') || inp.id === 'crm_lead_priority_input') {
                inp.value = String(newVal);
            }
        });

        const modalStars = document.getElementById('crm_lead_stars_container');
        if (modalStars) {
            const stars = modalStars.querySelectorAll('.crm-star-select');
            stars.forEach(function (s) {
                const sVal = parseInt(s.getAttribute('data-val') || '0', 10);
                if (newVal >= sVal && newVal > 0) {
                    s.textContent = '★';
                    s.style.color = '#f59e0b';
                } else {
                    s.textContent = '☆';
                    s.style.color = '#cbd5e1';
                }
            });
        }
    };

    /* ----------------------------------------------------- */
    /* LIVE SEARCH & FILTERING                               */
    /* ----------------------------------------------------- */
    const searchInput = document.getElementById('crm_lead_search');
    const searchClear = document.getElementById('crm_search_clear');

    const activeFilters = {
        search: '',
        type: 'opportunity',
        pipeline: 'all',
        stage: 'all',
        user: 'all',
        date: 'all'
    };

    let currentMode = 'opportunity';
    let currentView = 'kanban';

    const kanbanContainer = document.getElementById('crm_kanban_view');
    const leadsKanbanContainer = document.getElementById('crm_leads_kanban_view');
    const listContainer = document.getElementById('crm_list_view_container');
    const leadsListContainer = document.getElementById('crm_leads_list_view_container');
    const stagesDropdown = document.getElementById('dropdown_stages_wrapper');
    const btnPipeline = document.getElementById('dropdown_pipeline');
    const btnLeads = document.getElementById('dropdown_leads');
    const viewKanban = document.getElementById('crm_view_kanban');
    const viewList = document.getElementById('crm_view_list');

    function updateViewLayout() {
        activeFilters.type = currentMode;

        // Toggle toolbar button: My Pipeline shows New Opportunity, My Leads shows New Lead
        if (btnNewOpp) {
            if (currentMode === 'opportunity') {
                btnNewOpp.classList.remove('d-none', 'crm-btn-hidden');
                btnNewOpp.style.setProperty('display', 'inline-flex', 'important');
            } else {
                btnNewOpp.classList.add('d-none', 'crm-btn-hidden');
                btnNewOpp.style.setProperty('display', 'none', 'important');
            }
        }
        if (btnNewLead) {
            if (currentMode === 'lead') {
                btnNewLead.classList.remove('d-none', 'crm-btn-hidden');
                btnNewLead.style.setProperty('display', 'inline-flex', 'important');
            } else {
                btnNewLead.classList.add('d-none', 'crm-btn-hidden');
                btnNewLead.style.setProperty('display', 'none', 'important');
            }
        }

        if (btnToggleLead) {
            if (currentMode === 'opportunity') {
                btnToggleLead.innerHTML = '<i class="fa fa-plus me-1"></i> New Opportunity';
                btnToggleLead.title = 'New Opportunity';
                btnToggleLead.setAttribute('href', '#');
            } else {
                btnToggleLead.innerHTML = '<i class="fa fa-plus me-1"></i> New Lead';
                btnToggleLead.title = 'New Lead';
                btnToggleLead.setAttribute('href', '#');
            }
        }

        if (btnPipeline) {
            btnPipeline.classList.toggle('active', currentMode === 'opportunity');
        }
        if (btnLeads) {
            btnLeads.classList.toggle('active', currentMode === 'lead');
        }

        // Toggle KPI row: Opportunities KPIs vs Leads KPIs (Photo 1)
        const kpiOpportunities = document.getElementById('crm_kpi_opportunities');
        const kpiLeads = document.getElementById('crm_kpi_leads');
        if (kpiOpportunities && kpiLeads) {
            if (currentMode === 'opportunity') {
                kpiOpportunities.style.display = 'grid';
                kpiLeads.style.display = 'none';
            } else {
                kpiOpportunities.style.display = 'none';
                kpiLeads.style.display = 'grid';
            }
        }

        if (stagesDropdown) {
            stagesDropdown.style.display = (currentMode === 'opportunity') ? '' : 'none';
        }



        if (viewKanban) {
            viewKanban.classList.toggle('active', currentView === 'kanban');
        }
        if (viewList) {
            viewList.classList.toggle('active', currentView === 'list');
        }

        if (currentView === 'list') {
            if (kanbanContainer) kanbanContainer.style.display = 'none';
            if (leadsKanbanContainer) leadsKanbanContainer.style.display = 'none';
            if (currentMode === 'opportunity') {
                if (listContainer) listContainer.style.display = 'block';
                if (leadsListContainer) leadsListContainer.style.display = 'none';
            } else {
                if (listContainer) listContainer.style.display = 'none';
                if (leadsListContainer) leadsListContainer.style.display = 'block';
            }
        } else {
            if (listContainer) listContainer.style.display = 'none';
            if (leadsListContainer) leadsListContainer.style.display = 'none';
            if (currentMode === 'opportunity') {
                if (kanbanContainer) kanbanContainer.style.display = 'flex';
                if (leadsKanbanContainer) leadsKanbanContainer.style.display = 'none';
            } else {
                if (kanbanContainer) kanbanContainer.style.display = 'none';
                if (leadsKanbanContainer) leadsKanbanContainer.style.display = 'block';
            }
        }

        applyFilters();
    }

    let crmOppListPage = 1;
    let crmLeadListPage = 1;
    const crmPageSize = 20;

    function renderOppListPagination(matchingRows, totalRevenue) {
        const total = matchingRows.length;
        const totalPages = Math.max(1, Math.ceil(total / crmPageSize));
        if (crmOppListPage > totalPages) crmOppListPage = totalPages;
        if (crmOppListPage < 1) crmOppListPage = 1;

        matchingRows.forEach(function (row, idx) {
            const inPage = (idx >= (crmOppListPage - 1) * crmPageSize) && (idx < crmOppListPage * crmPageSize);
            row.style.display = inPage ? '' : 'none';
        });

        const noRecordsRow = document.getElementById('crm_list_no_records');
        if (noRecordsRow) {
            noRecordsRow.style.display = (total === 0) ? '' : 'none';
        }

        const countEl = document.getElementById('crm_list_count_display');
        if (countEl) {
            if (total === 0) {
                countEl.textContent = '0 of 0';
            } else {
                const start = (crmOppListPage - 1) * crmPageSize + 1;
                const end = Math.min(total, crmOppListPage * crmPageSize);
                countEl.textContent = start + '-' + end + ' of ' + total;
            }
        }

        const totalEl = document.getElementById('crm_list_total_display');
        if (totalEl) {
            totalEl.textContent = 'Total $' + totalRevenue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }

        const pagContainer = document.getElementById('crm_list_pagination');
        if (pagContainer) {
            if (total <= crmPageSize) {
                pagContainer.style.display = 'none';
            } else {
                pagContainer.style.display = 'inline-flex';
                let html = '<button type="button" class="crm-page-nav-btn" id="crm_page_prev" ' + (crmOppListPage <= 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : '') + ' title="Previous page">&lt;</button>';
                for (let p = 1; p <= totalPages; p++) {
                    html += '<button type="button" class="crm-page-num-btn ' + (p === crmOppListPage ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>';
                }
                html += '<button type="button" class="crm-page-nav-btn" id="crm_page_next" ' + (crmOppListPage >= totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : '') + ' title="Next page">&gt;</button>';
                pagContainer.innerHTML = html;

                pagContainer.querySelectorAll('.crm-page-num-btn').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        crmOppListPage = parseInt(this.getAttribute('data-page'));
                        applyFilters();
                    });
                });
                const prevBtn = document.getElementById('crm_page_prev');
                if (prevBtn && crmOppListPage > 1) {
                    prevBtn.addEventListener('click', function () {
                        crmOppListPage -= 1;
                        applyFilters();
                    });
                }
                const nextBtn = document.getElementById('crm_page_next');
                if (nextBtn && crmOppListPage < totalPages) {
                    nextBtn.addEventListener('click', function () {
                        crmOppListPage += 1;
                        applyFilters();
                    });
                }
            }
        }
    }

    function renderLeadsListPagination(matchingRows) {
        const total = matchingRows.length;
        const totalPages = Math.max(1, Math.ceil(total / crmPageSize));
        if (crmLeadListPage > totalPages) crmLeadListPage = totalPages;
        if (crmLeadListPage < 1) crmLeadListPage = 1;

        matchingRows.forEach(function (row, idx) {
            const inPage = (idx >= (crmLeadListPage - 1) * crmPageSize) && (idx < crmLeadListPage * crmPageSize);
            row.style.display = inPage ? '' : 'none';
        });

        const noRecordsRow = document.getElementById('crm_leads_list_no_records');
        if (noRecordsRow) {
            noRecordsRow.style.display = (total === 0) ? '' : 'none';
        }

        const countEl = document.getElementById('crm_leads_list_count_display');
        if (countEl) {
            if (total === 0) {
                countEl.textContent = '0 of 0';
            } else {
                const start = (crmLeadListPage - 1) * crmPageSize + 1;
                const end = Math.min(total, crmLeadListPage * crmPageSize);
                countEl.textContent = start + '-' + end + ' of ' + total;
            }
        }

        const totalEl = document.getElementById('crm_leads_list_total_display');
        if (totalEl) {
            totalEl.textContent = 'Total Leads: ' + total;
        }

        const pagContainer = document.getElementById('crm_leads_list_pagination');
        if (pagContainer) {
            if (total <= crmPageSize) {
                pagContainer.style.display = 'none';
            } else {
                pagContainer.style.display = 'inline-flex';
                let html = '<button type="button" class="crm-page-nav-btn" id="crm_leads_page_prev" ' + (crmLeadListPage <= 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : '') + ' title="Previous page">&lt;</button>';
                for (let p = 1; p <= totalPages; p++) {
                    html += '<button type="button" class="crm-page-num-btn ' + (p === crmLeadListPage ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>';
                }
                html += '<button type="button" class="crm-page-nav-btn" id="crm_leads_page_next" ' + (crmLeadListPage >= totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : '') + ' title="Next page">&gt;</button>';
                pagContainer.innerHTML = html;

                pagContainer.querySelectorAll('.crm-page-num-btn').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        crmLeadListPage = parseInt(this.getAttribute('data-page'));
                        applyFilters();
                    });
                });
                const prevBtn = document.getElementById('crm_leads_page_prev');
                if (prevBtn && crmLeadListPage > 1) {
                    prevBtn.addEventListener('click', function () {
                        crmLeadListPage -= 1;
                        applyFilters();
                    });
                }
                const nextBtn = document.getElementById('crm_leads_page_next');
                if (nextBtn && crmLeadListPage < totalPages) {
                    nextBtn.addEventListener('click', function () {
                        crmLeadListPage += 1;
                        applyFilters();
                    });
                }
            }
        }
    }

    function applyFilters() {
        const query = activeFilters.search.toLowerCase().trim();

        if (currentMode === 'opportunity') {
            // Filter Pipeline Stage Cards
            const oppCards = document.querySelectorAll('#crm_kanban_view .crm-lead-card');
            oppCards.forEach(function (card) {
                const searchData = card.getAttribute('data-search') || '';
                const stageId = card.getAttribute('data-stage-id');
                const priority = card.getAttribute('data-priority');
                const userId = card.getAttribute('data-user-id');
                const itemDate = card.getAttribute('data-date');

                let matchesSearch = !query || searchData.indexOf(query) !== -1;
                let matchesPipeline = true;
                if (activeFilters.pipeline === 'starred') {
                    matchesPipeline = priority === '1' || priority === '2' || priority === '3';
                }
                let matchesStage = activeFilters.stage === 'all' || stageId === activeFilters.stage;
                let matchesUser = true;
                if (activeFilters.user === 'unassigned') {
                    matchesUser = userId === '0' || !userId;
                }
                let matchesDate = true;
                if (activeFilters.date === 'month') {
                    if (itemDate) {
                        const now = new Date();
                        const curYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
                        matchesDate = itemDate.startsWith(curYm);
                    }
                } else if (activeFilters.date === 'quarter') {
                    if (itemDate) {
                        const now = new Date();
                        const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
                        const start = new Date(now.getFullYear(), qStartMonth, 1);
                        const end = new Date(now.getFullYear(), qStartMonth + 3, 0);
                        const d = new Date(itemDate);
                        matchesDate = false;
                        if (d >= start && end >= d) {
                            matchesDate = true;
                        }
                    }
                }

                let isVisible = matchesSearch;
                if (!matchesPipeline) isVisible = false;
                if (!matchesStage) isVisible = false;
                if (!matchesUser) isVisible = false;
                if (!matchesDate) isVisible = false;
                card.style.display = isVisible ? 'block' : 'none';
            });

            // Update Column Counters and Revenue Totals
            document.querySelectorAll('.crm-portal-stage').forEach(function (col) {
                const stageId = col.getAttribute('data-stage-id');
                const visibleCards = Array.from(col.querySelectorAll('.crm-lead-card')).filter(function (c) {
                    return c.style.display !== 'none' && !c.classList.contains('d-none');
                });
                const pill = col.querySelector('.crm-stage-count-pill');
                const amount = col.querySelector('.crm-stage-amount');
                const emptyMsg = col.querySelector('.crm-empty-stage');

                if (pill) pill.textContent = visibleCards.length;

                if (amount) {
                    let totalRev = 0;
                    visibleCards.forEach(function (c) {
                        totalRev += parseFloat(c.getAttribute('data-revenue') || 0);
                    });
                    amount.textContent = '$ ' + totalRev.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    });
                }

                if (emptyMsg) {
                    emptyMsg.style.display = (visibleCards.length === 0) ? 'flex' : 'none';
                }

                if (activeFilters.stage !== 'all') {
                    col.style.display = (stageId === activeFilters.stage) ? 'block' : 'none';
                } else {
                    col.style.display = 'block';
                }
            });
        } else {
            // Filter Leads Kanban Cards
            const leadItems = document.querySelectorAll('.crm-lead-kanban-item');
            let visibleLeadCount = 0;
            leadItems.forEach(function (item) {
                const searchData = item.getAttribute('data-search') || '';
                const userId = item.getAttribute('data-user-id');
                const priority = item.getAttribute('data-priority');
                const itemDate = item.getAttribute('data-date');

                let matchesSearch = !query || searchData.indexOf(query) !== -1;
                let matchesUser = true;
                if (activeFilters.user === 'unassigned') {
                    matchesUser = userId === '0' || !userId;
                }
                let matchesPriority = true;
                if (activeFilters.pipeline === 'starred') {
                    matchesPriority = priority === '1' || priority === '2' || priority === '3';
                }
                let matchesDate = true;
                if (activeFilters.date === 'month') {
                    if (itemDate) {
                        const now = new Date();
                        const curYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
                        matchesDate = itemDate.startsWith(curYm);
                    }
                } else if (activeFilters.date === 'quarter') {
                    if (itemDate) {
                        const now = new Date();
                        const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
                        const start = new Date(now.getFullYear(), qStartMonth, 1);
                        const end = new Date(now.getFullYear(), qStartMonth + 3, 0);
                        const d = new Date(itemDate);
                        matchesDate = false;
                        if (d >= start && end >= d) {
                            matchesDate = true;
                        }
                    }
                }

                let isVisible = matchesSearch;
                if (!matchesUser) isVisible = false;
                if (!matchesPriority) isVisible = false;
                if (!matchesDate) isVisible = false;
                item.style.display = isVisible ? '' : 'none';
                if (isVisible) visibleLeadCount += 1;
            });

            const emptyState = document.getElementById('crm_leads_empty_state');
            if (emptyState) {
                emptyState.style.display = (visibleLeadCount === 0) ? 'block' : 'none';
            }
        }

        const todayStr = new Date().toISOString().slice(0, 10);

        // 1. Filter Opportunity List Rows
        const oppRows = document.querySelectorAll('#crm_list_view_container .crm-list-row');
        let matchingOppRows = [];
        let visibleOppTotalRev = 0;

        oppRows.forEach(function (row) {
            const rowType = row.getAttribute('data-type') || 'lead';
            const searchData = row.getAttribute('data-search') || '';
            const stageId = row.getAttribute('data-stage-id');
            const priority = row.getAttribute('data-priority');
            const userId = row.getAttribute('data-user-id');
            const itemDate = row.getAttribute('data-date');

            let matchesType = (rowType !== 'lead');
            let matchesSearch = !query || searchData.indexOf(query) !== -1;
            let matchesPipeline = activeFilters.pipeline !== 'starred' || (priority === '1' || priority === '2' || priority === '3');
            let matchesStage = activeFilters.stage === 'all' || stageId === activeFilters.stage;
            let matchesUser = activeFilters.user !== 'unassigned' || (userId === '0' || !userId);

            let matchesDate = true;
            if (activeFilters.date === 'month') {
                if (itemDate) {
                    const now = new Date();
                    const curYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
                    matchesDate = itemDate.startsWith(curYm);
                }
            } else if (activeFilters.date === 'quarter') {
                if (itemDate) {
                    const now = new Date();
                    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
                    const start = new Date(now.getFullYear(), qStartMonth, 1);
                    const end = new Date(now.getFullYear(), qStartMonth + 3, 0);
                    const d = new Date(itemDate);
                    matchesDate = false;
                    if (d >= start && end >= d) {
                        matchesDate = true;
                    }
                }
            }

            let visible = matchesType && matchesSearch && matchesPipeline && matchesStage && matchesUser && matchesDate;

            // Check overdue indicator on closing date cell
            const dateCell = row.querySelector('.crm-closing-date-normal, .crm-closing-date-overdue');
            if (dateCell) {
                const dl = dateCell.getAttribute('data-deadline');
                const stagePill = row.querySelector('.crm-stage-pill');
                const isWon = stagePill && stagePill.classList.contains('crm-stage-won');
                if (dl && dl < todayStr && !isWon) {
                    dateCell.className = 'crm-closing-date-overdue';
                    if (!dateCell.querySelector('i.fa-clock-o')) {
                        dateCell.innerHTML = '<i class="fa fa-clock-o"></i> <span>' + dateCell.textContent.trim() + '</span>';
                    }
                }
            }

            if (visible) {
                matchingOppRows.push(row);
                visibleOppTotalRev += parseFloat(row.getAttribute('data-revenue') || 0);
            } else {
                row.style.display = 'none';
            }
        });
        renderOppListPagination(matchingOppRows, visibleOppTotalRev);

        // 2. Filter Leads List Rows
        const leadRows = document.querySelectorAll('#crm_leads_list_view_container .crm-list-row');
        let matchingLeadRows = [];

        leadRows.forEach(function (row) {
            const rowType = row.getAttribute('data-type') || 'lead';
            const searchData = row.getAttribute('data-search') || '';
            const priority = row.getAttribute('data-priority');
            const userId = row.getAttribute('data-user-id');
            const itemDate = row.getAttribute('data-date');

            let matchesType = (rowType === 'lead');
            let matchesSearch = !query || searchData.indexOf(query) !== -1;
            let matchesPipeline = activeFilters.pipeline !== 'starred' || (priority === '1' || priority === '2' || priority === '3');
            let matchesUser = activeFilters.user !== 'unassigned' || (userId === '0' || !userId);

            let matchesDate = true;
            if (activeFilters.date === 'month') {
                if (itemDate) {
                    const now = new Date();
                    const curYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
                    matchesDate = itemDate.startsWith(curYm);
                }
            } else if (activeFilters.date === 'quarter') {
                if (itemDate) {
                    const now = new Date();
                    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
                    const start = new Date(now.getFullYear(), qStartMonth, 1);
                    const end = new Date(now.getFullYear(), qStartMonth + 3, 0);
                    const d = new Date(itemDate);
                    matchesDate = false;
                    if (d >= start && end >= d) {
                        matchesDate = true;
                    }
                }
            }

            let visible = matchesType && matchesSearch && matchesPipeline && matchesUser && matchesDate;

            if (visible) {
                matchingLeadRows.push(row);
            } else {
                row.style.display = 'none';
            }
        });
        renderLeadsListPagination(matchingLeadRows);
    }

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            activeFilters.search = searchInput.value;
            crmOppListPage = 1;
            crmLeadListPage = 1;
            if (searchClear) searchClear.style.display = searchInput.value ? 'block' : 'none';
            applyFilters();
        });
    }

    if (searchClear) {
        searchClear.addEventListener('click', function () {
            searchInput.value = '';
            activeFilters.search = '';
            searchClear.style.display = 'none';
            applyFilters();
        });
    }

    // View Switcher Buttons
    if (viewKanban) {
        viewKanban.addEventListener('click', function () {
            currentView = 'kanban';
            updateViewLayout();
        });
    }

    if (viewList) {
        viewList.addEventListener('click', function () {
            currentView = 'list';
            updateViewLayout();
        });
    }

    // Pipeline Button Click
    if (btnPipeline) {
        btnPipeline.addEventListener('click', function () {
            currentMode = 'opportunity';
            updateViewLayout();
        });
    }

    // Pipeline Filter Dropdown Options
    document.querySelectorAll('.crm-filter-pipeline-opt').forEach(function (item) {
        item.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelectorAll('.crm-filter-pipeline-opt').forEach(o => o.classList.remove('active'));
            item.classList.add('active');
            const label = document.getElementById('label_pipeline_filter');
            if (label) label.textContent = item.textContent.trim();
            activeFilters.pipeline = item.getAttribute('data-filter') || 'all';
            currentMode = 'opportunity';
            updateViewLayout();
        });
    });

    // Stage Filter Dropdown Options
    document.querySelectorAll('.crm-filter-stage-opt').forEach(function (item) {
        item.addEventListener('click', function (e) {
            if (item.getAttribute('data-stage') === 'lost') {
                window.location.href = '/my/leads?stage=lost';
                return;
            }

            e.preventDefault();
            document.querySelectorAll('.crm-filter-stage-opt').forEach(o => o.classList.remove('active'));
            item.classList.add('active');
            const label = document.getElementById('label_stage_filter');
            if (label) label.textContent = item.textContent.trim();
            activeFilters.stage = item.getAttribute('data-stage');
            applyFilters();
        });
    });

    // Leads Button Click
    if (btnLeads) {
        btnLeads.addEventListener('click', function () {
            currentMode = 'lead';
            updateViewLayout();
        });
    }

    // Leads Filter Dropdown Options
    document.querySelectorAll('.crm-filter-leads-opt').forEach(function (item) {
        item.addEventListener('click', function (e) {
            if (item.getAttribute('data-stage') === 'lost_leads') {
                window.location.href = '/my/leads?stage=lost_leads';
                return;
            }
            e.preventDefault();
            document.querySelectorAll('.crm-filter-leads-opt').forEach(o => o.classList.remove('active'));
            item.classList.add('active');
            const label = document.getElementById('label_user_filter');
            if (label) label.textContent = item.textContent.trim();
            activeFilters.user = item.getAttribute('data-user') || 'all';
            currentMode = 'lead';
            updateViewLayout();
        });
    });

    // Date Filter Dropdown Options
    document.querySelectorAll('.crm-filter-date-opt').forEach(function (item) {
        item.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelectorAll('.crm-filter-date-opt').forEach(o => o.classList.remove('active'));
            item.classList.add('active');
            const label = document.getElementById('label_date_filter');
            if (label) label.textContent = item.textContent.trim();
            activeFilters.date = item.getAttribute('data-date');
            applyFilters();
        });
    });

    // Initialize View based on URL params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('type') === 'lead') {
        currentMode = 'lead';
        currentView = (urlParams.get('view') === 'list') ? 'list' : 'kanban';
    } else {
        currentMode = 'opportunity';
        currentView = (urlParams.get('view') === 'list') ? 'list' : 'kanban';
    }
    updateViewLayout();

    /* ----------------------------------------------------- */
    /* DRAG AND DROP FUNCTIONALITY                           */
    /* ----------------------------------------------------- */
    document.querySelectorAll('.crm-lead-card').forEach(function (card) {
        card.addEventListener('dragstart', function (event) {
            draggedLead = card;
            card.style.opacity = '0.4';
            card.classList.add('crm-card-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', card.getAttribute('data-lead-id'));
        });

        card.addEventListener('dragend', function () {
            card.style.opacity = '1';
            card.classList.remove('crm-card-dragging');
            draggedLead = null;
            document.querySelectorAll('.crm-drop-zone').forEach(function (z) {
                z.classList.remove('crm-drag-over');
            });
        });
    });

    document.querySelectorAll('.crm-drop-zone').forEach(function (zone) {
        zone.addEventListener('dragover', function (event) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            zone.classList.add('crm-drag-over');
        });

        zone.addEventListener('dragleave', function () {
            zone.classList.remove('crm-drag-over');
        });

        zone.addEventListener('drop', function (event) {
            event.preventDefault();
            zone.classList.remove('crm-drag-over');

            if (!draggedLead) return;

            const leadId = draggedLead.getAttribute('data-lead-id');
            const newStageId = zone.getAttribute('data-stage-id');
            const currentStage = draggedLead.getAttribute('data-current-stage');

            if (currentStage === newStageId) return;

            const csrfEl = document.getElementById('crm_pipeline_csrf_token');
            const csrfToken = csrfEl ? csrfEl.value : '';

            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/my/leads/' + leadId + '/stage';

            const csrfInput = document.createElement('input');
            csrfInput.type = 'hidden';
            csrfInput.name = 'csrf_token';
            csrfInput.value = csrfToken;
            form.appendChild(csrfInput);

            const stageInput = document.createElement('input');
            stageInput.type = 'hidden';
            stageInput.name = 'stage_id';
            stageInput.value = newStageId;
            form.appendChild(stageInput);

            document.body.appendChild(form);
            form.submit();
        });
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCrmPipeline);
} else {
    initCrmPipeline();
}
