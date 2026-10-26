/* @odoo-module ignore */
/**
 * CRM Portal: Convert to Opportunity Modal & Merge Opportunities
 * Handles modal display, salesperson avatar changes, customer linking options,
 * merge candidate selection and row management, and manual priority setting.
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

function syncCustomerUI() {
    var actCreate = document.getElementById("crm_customer_action_create");
    var actExist = document.getElementById("crm_customer_action_exist");
    var compSec = document.getElementById("crm_convert_modal_company_section");
    var partSec = document.getElementById("crm_convert_modal_partner_section");
    var compSel = document.getElementById("crm_convert_modal_company_select");
    var partSel = document.getElementById("crm_convert_modal_partner_select");

    var isExist = !!(actExist && actExist.checked);
    if (isExist) {
        if (compSec) compSec.style.setProperty("display", "none", "important");
        if (partSec) partSec.style.setProperty("display", "flex", "important");
        if (compSel) compSel.disabled = true;
        if (partSel) partSel.disabled = false;
    } else {
        if (compSec) compSec.style.setProperty("display", "flex", "important");
        if (partSec) partSec.style.setProperty("display", "none", "important");
        if (compSel) compSel.disabled = false;
        if (partSel) partSel.disabled = true;
    }
}

function syncConversionActionUI() {
    var actMerge = document.getElementById("crm_convert_action_merge") ||
                   document.querySelector('input[name="conversion_action"][value="merge"]');
    var custSection = document.getElementById("crm_convert_customer_section");
    var mergeSection = document.getElementById("crm_convert_merge_section");
    var submitBtn = document.getElementById("crm_btn_convert_opportunity");

    if (actMerge && actMerge.checked) {
        if (custSection) custSection.style.setProperty("display", "none", "important");
        if (mergeSection) mergeSection.style.setProperty("display", "block", "important");
        if (submitBtn) submitBtn.textContent = "Create Opportunity";
    } else {
        if (custSection) custSection.style.setProperty("display", "flex", "important");
        if (mergeSection) mergeSection.style.setProperty("display", "none", "important");
        if (submitBtn) submitBtn.textContent = "Convert Opportunity";
    }
}

function updateMergeEmptyRowState() {
    var tbody = document.getElementById("crm_merge_opps_tbody");
    if (!tbody) return;
    var rows = tbody.querySelectorAll(".crm-merge-candidate-row");
    var anyVisible = false;
    rows.forEach(function (r) {
        if (r.style.display !== "none") {
            anyVisible = true;
        }
    });
    var emptyRow = document.getElementById("crm_merge_empty_row");
    if (emptyRow) {
        emptyRow.style.display = anyVisible ? "none" : "";
    }
}

function openConvertModal(leadId, leadName, userId, teamId, partnerId, redirectUrl, companyName, companyPartnerId) {
    var m = document.getElementById("crm_convert_opportunity_modal");
    if (!m) return;

    if (!leadId) {
        var detailBtn = document.getElementById("btn_open_convert_modal");
        if (detailBtn && detailBtn.getAttribute("data-lead-id")) {
            leadId = detailBtn.getAttribute("data-lead-id");
            if (!userId) userId = detailBtn.getAttribute("data-user-id");
            if (!teamId) teamId = detailBtn.getAttribute("data-team-id");
            if (!partnerId) partnerId = detailBtn.getAttribute("data-partner-id");
            if (!redirectUrl) redirectUrl = detailBtn.getAttribute("data-redirect");
            if (!companyName) companyName = detailBtn.getAttribute("data-company-name");
            if (!companyPartnerId) companyPartnerId = detailBtn.getAttribute("data-company-id");
        }
    }

    var pageCompInp = document.querySelector('#crm_lead_form input[name="company_name"]') ||
                      document.querySelector('input[name="company_name"]');
    if (pageCompInp && pageCompInp.value && pageCompInp.value.trim()) {
        companyName = pageCompInp.value.trim();
    }

    if (leadId) {
        var leadInput = document.getElementById("crm_convert_modal_lead_id");
        if (leadInput) leadInput.value = leadId;
    }
    if (redirectUrl) {
        var redInput = document.getElementById("crm_convert_modal_redirect");
        if (redInput) redInput.value = redirectUrl;
    }
    var userSel = document.getElementById("crm_convert_modal_user_select");
    if (userId && userSel) {
        userSel.value = userId;
        var opt = userSel.options[userSel.selectedIndex];
        var av = opt ? opt.getAttribute("data-avatar") : null;
        var avImg = document.getElementById("crm_convert_modal_avatar_img");
        if (av && avImg) avImg.src = av;
    }
    if (teamId) {
        var teamSel = document.getElementById("crm_convert_modal_team_select");
        if (teamSel) teamSel.value = teamId;
    }

    // Auto-select or add companyName in Company dropdown
    var compSel = document.getElementById("crm_convert_modal_company_select");
    if (compSel) {
        if (companyName) {
            var found = false;
            for (var i = 0; i < compSel.options.length; i++) {
                var oVal = compSel.options[i].value;
                var oTxt = compSel.options[i].text.trim().toLowerCase();
                if ((companyPartnerId && oVal === String(companyPartnerId)) || oTxt === companyName.toLowerCase()) {
                    compSel.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found) {
                var newOpt = document.createElement("option");
                newOpt.value = "new:" + companyName;
                newOpt.text = companyName;
                newOpt.selected = true;
                compSel.insertBefore(newOpt, compSel.firstChild);
                compSel.selectedIndex = 0;
            }
        } else if (companyPartnerId) {
            compSel.value = String(companyPartnerId);
        }
    }

    if (partnerId) {
        var partSel = document.getElementById("crm_convert_modal_partner_select");
        if (partSel) partSel.value = partnerId;
        var actExist = document.getElementById("crm_customer_action_exist");
        if (actExist) {
            actExist.checked = true;
            syncCustomerUI();
        }
    } else {
        var actCreate = document.getElementById("crm_customer_action_create");
        if (actCreate) {
            actCreate.checked = true;
            syncCustomerUI();
        }
    }

    // Default action: Convert to opportunity
    var actConvert = document.getElementById("crm_convert_action_convert");
    var actMerge = document.getElementById("crm_convert_action_merge");
    if (actConvert && (!actMerge || !actMerge.checked)) {
        actConvert.checked = true;
    }
    syncConversionActionUI();

    // Filter candidate opportunities so current lead cannot merge into itself
    if (leadId) {
        var selectAdd = document.getElementById("crm_select_opportunity_to_add");
        if (selectAdd) {
            for (var i = 0; i < selectAdd.options.length; i++) {
                var o = selectAdd.options[i];
                if (o.value === String(leadId)) {
                    o.disabled = true;
                    o.style.display = "none";
                } else {
                    o.disabled = false;
                    o.style.display = "";
                }
            }
        }
        var curRow = document.querySelector('.crm-merge-candidate-row[data-opp-id="' + leadId + '"]');
        if (curRow) {
            curRow.style.display = "none";
            var inpHid = curRow.querySelector(".crm-merge-opp-input");
            if (inpHid) inpHid.disabled = true;
        }
    }

    updateMergeEmptyRowState();

    m.style.setProperty("display", "flex", "important");
    m.setAttribute("aria-hidden", "false");
}

function closeConvertModal() {
    var m = document.getElementById("crm_convert_opportunity_modal");
    if (m) {
        m.style.setProperty("display", "none", "important");
        m.setAttribute("aria-hidden", "true");
    }
}

// Expose globally for inline triggers
window.openConvertModal = openConvertModal;
window.closeConvertModal = closeConvertModal;
window.syncCustomerUI = syncCustomerUI;
window.syncConversionActionUI = syncConversionActionUI;
window.updateMergeEmptyRowState = updateMergeEmptyRowState;

function initConvertModal() {
    if (window.__crm_convert_modal_initialized) return;
    window.__crm_convert_modal_initialized = true;

    var userSel = document.getElementById("crm_convert_modal_user_select");
    var avImg = document.getElementById("crm_convert_modal_avatar_img");
    if (userSel && avImg) {
        userSel.addEventListener("change", function () {
            var opt = userSel.options[userSel.selectedIndex];
            var av = opt ? opt.getAttribute("data-avatar") : null;
            if (av) avImg.src = av;
        });
    }

    var actCreate = document.getElementById("crm_customer_action_create");
    var actExist = document.getElementById("crm_customer_action_exist");

    if (actCreate) {
        actCreate.addEventListener("change", syncCustomerUI);
        actCreate.addEventListener("click", syncCustomerUI);
    }
    if (actExist) {
        actExist.addEventListener("change", syncCustomerUI);
        actExist.addEventListener("click", syncCustomerUI);
    }

    var convRadios = document.querySelectorAll('input[name="conversion_action"]');
    convRadios.forEach(function (radio) {
        radio.addEventListener("change", syncConversionActionUI);
    });

    // Merge Candidate selection & "Add a line"
    var btnAddLine = document.getElementById("crm_btn_add_opp_line");
    var selectAddCont = document.getElementById("crm_add_line_select_container");
    var selectAdd = document.getElementById("crm_select_opportunity_to_add");
    var btnCancelAdd = document.getElementById("crm_btn_cancel_add_line");

    if (btnAddLine && selectAddCont) {
        btnAddLine.addEventListener("click", function (e) {
            e.preventDefault();
            btnAddLine.style.display = "none";
            selectAddCont.style.display = "block";
            if (selectAdd) {
                selectAdd.value = "";
                selectAdd.focus();
            }
        });
    }

    if (btnCancelAdd && btnAddLine && selectAddCont) {
        btnCancelAdd.addEventListener("click", function (e) {
            e.preventDefault();
            selectAddCont.style.display = "none";
            btnAddLine.style.display = "";
            if (selectAdd) selectAdd.value = "";
        });
    }

    if (selectAdd && btnAddLine && selectAddCont) {
        selectAdd.addEventListener("change", function () {
            var oppId = selectAdd.value;
            if (!oppId) return;

            var targetRow = document.querySelector('.crm-merge-candidate-row[data-opp-id="' + oppId + '"]');
            if (targetRow) {
                targetRow.style.display = "";
                var hiddenInput = targetRow.querySelector(".crm-merge-opp-input");
                if (hiddenInput) hiddenInput.disabled = false;
            }

            selectAdd.value = "";
            selectAddCont.style.display = "none";
            btnAddLine.style.display = "";
            updateMergeEmptyRowState();
        });
    }

    // Remove candidate row
    var oppTbody = document.getElementById("crm_merge_opps_tbody");
    if (oppTbody) {
        oppTbody.addEventListener("click", function (e) {
            var rmBtn = e.target.closest(".crm-remove-merge-row");
            if (!rmBtn) return;
            e.preventDefault();
            var row = rmBtn.closest(".crm-merge-candidate-row");
            if (row) {
                row.style.display = "none";
                var hiddenInput = row.querySelector(".crm-merge-opp-input");
                if (hiddenInput) hiddenInput.disabled = true;
                updateMergeEmptyRowState();
            }
        });
    }

    var convertModal = document.getElementById("crm_convert_opportunity_modal");
    if (convertModal) {
        convertModal.addEventListener("click", function (e) {
            if (e.target === convertModal) {
                closeConvertModal();
            }
        });
    }

    var convertForm = document.getElementById("crm_convert_opportunity_form");
    if (convertForm) {
        convertForm.addEventListener("submit", function () {
            var detailForm = document.getElementById("crm_lead_form") || document.querySelector(".crm-mockup-container form");
            if (detailForm) {
                var fieldNames = ['company_name', 'contact_name', 'email_from', 'phone', 'website', 'function', 'street', 'street2', 'city', 'zip', 'state_id', 'country_id'];
                fieldNames.forEach(function (fname) {
                    var detailInput = detailForm.querySelector('[name="' + fname + '"]');
                    if (detailInput && detailInput.value) {
                        var existing = convertForm.querySelector('input[name="' + fname + '"]');
                        if (!existing) {
                            existing = document.createElement("input");
                            existing.type = "hidden";
                            existing.name = fname;
                            convertForm.appendChild(existing);
                        }
                        existing.value = detailInput.value;
                    }
                });
            }
            // If company_name is selected as new in crm_convert_modal_company_select
            var compSel = document.getElementById("crm_convert_modal_company_select");
            if (compSel && compSel.value && compSel.value.indexOf("new:") === 0) {
                var cName = compSel.value.substring(4).trim();
                if (cName) {
                    var ex = convertForm.querySelector('input[name="company_name"]');
                    if (!ex) {
                        ex = document.createElement("input");
                        ex.type = "hidden";
                        ex.name = "company_name";
                        convertForm.appendChild(ex);
                    }
                    ex.value = cName;
                }
            }
        });
    }

    var detailBtn = document.getElementById("btn_open_convert_modal");
    if (detailBtn) {
        detailBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var lid = detailBtn.getAttribute("data-lead-id");
            var lname = detailBtn.getAttribute("data-lead-name");
            var uid = detailBtn.getAttribute("data-user-id");
            var tid = detailBtn.getAttribute("data-team-id");
            var pid = detailBtn.getAttribute("data-partner-id");
            var red = detailBtn.getAttribute("data-redirect");
            var cname = detailBtn.getAttribute("data-company-name");
            var cid = detailBtn.getAttribute("data-company-id");
            openConvertModal(lid, lname, uid, tid, pid, red, cname, cid);
        });
    }

    document.querySelectorAll(".crm-trigger-convert-modal").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var lid = btn.getAttribute("data-lead-id");
            var lname = btn.getAttribute("data-lead-name");
            var uid = btn.getAttribute("data-user-id");
            var tid = btn.getAttribute("data-team-id");
            var pid = btn.getAttribute("data-partner-id");
            var red = btn.getAttribute("data-redirect");
            var cname = btn.getAttribute("data-company-name");
            var cid = btn.getAttribute("data-company-id");
            openConvertModal(lid, lname, uid, tid, pid, red, cname, cid);
        });
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" || e.key === "Esc") {
            closeConvertModal();
        }
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initConvertModal);
} else {
    initConvertModal();
}
