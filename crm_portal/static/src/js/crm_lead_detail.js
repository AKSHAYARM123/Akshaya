/* @odoo-module ignore */
/**
 * CRM Portal: Lead Detail Interaction
 * Handles Won/Lost modals, tabs switching, tags selector, salesperson avatar changes,
 * partner auto-fill, and interactive priority star ratings.
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

function openWonModal() {
    var m = document.getElementById("crm_portal_won_modal");
    if (m) {
        m.classList.add("show");
        m.style.setProperty("display", "flex", "important");
        m.setAttribute("aria-hidden", "false");
    }
}

function closeWonModal() {
    var m = document.getElementById("crm_portal_won_modal");
    if (m) {
        m.classList.remove("show");
        m.style.setProperty("display", "none", "important");
        m.setAttribute("aria-hidden", "true");
    }
}

function openLostModal() {
    var m = document.getElementById("crm_portal_lost_modal");
    if (m) {
        m.classList.add("show");
        m.style.setProperty("display", "flex", "important");
        m.setAttribute("aria-hidden", "false");
    }
}

function closeLostModal() {
    var m = document.getElementById("crm_portal_lost_modal");
    if (m) {
        m.classList.remove("show");
        m.style.setProperty("display", "none", "important");
        m.setAttribute("aria-hidden", "true");
    }
}

function switchTab(btn, targetId) {
    var container = btn.closest(".crm-tab-container");
    if (!container) return;
    var buttons = container.querySelectorAll(".crm-tab-nav-btn");
    buttons.forEach(function (b) {
        b.classList.remove("active");
    });
    btn.classList.add("active");
    var panes = container.querySelectorAll(".crm-tab-content-pane");
    panes.forEach(function (pane) {
        pane.classList.add("d-none");
    });
    var targetPane = document.getElementById(targetId);
    if (targetPane) {
        targetPane.classList.remove("d-none");
    }
}

function updateSalespersonAvatar(sel, imgId) {
    var opt = sel.options[sel.selectedIndex];
    var av = opt ? opt.getAttribute("data-avatar") : null;
    var img = document.getElementById(imgId);
    if (img && av) {
        img.src = av;
    }
}

function updateTags(cb, textId) {
    var dropdown = cb.closest(".dropdown");
    if (!dropdown) return;
    var inputs = dropdown.querySelectorAll(".crm-tag-input-item:checked");
    var names = [];
    inputs.forEach(function (inp) {
        var n = inp.getAttribute("data-tag-name");
        if (n) names.push(n);
    });
    var textElem = document.getElementById(textId);
    if (textElem) {
        textElem.textContent = names.length > 0 ? names.join(", ") : "Select Tags";
    }
}

function onPartnerChange(selectElem) {
    var opt = selectElem.options[selectElem.selectedIndex];
    if (!opt || !opt.value) return;
    var form = selectElem.closest("form");
    if (!form) return;

    var email = opt.getAttribute("data-email");
    var phone = opt.getAttribute("data-phone");
    var company = opt.getAttribute("data-company");
    var contact = opt.getAttribute("data-contact");
    var street = opt.getAttribute("data-street");
    var street2 = opt.getAttribute("data-street2");
    var city = opt.getAttribute("data-city");
    var zip = opt.getAttribute("data-zip");
    var website = opt.getAttribute("data-website");
    var fn = opt.getAttribute("data-function");
    var country = opt.getAttribute("data-country");
    var state = opt.getAttribute("data-state");

    var emailInp = form.querySelector('input[name="email_from"]');
    if (emailInp && email) emailInp.value = email;

    var phoneInp = form.querySelector('input[name="phone"]');
    if (phoneInp && phone) phoneInp.value = phone;

    var compInp = form.querySelector('input[name="company_name"]');
    if (compInp && company) compInp.value = company;

    var contactInp = form.querySelector('input[name="contact_name"]');
    if (contactInp && contact) contactInp.value = contact;

    var streetInp = form.querySelector('input[name="street"]');
    if (streetInp && street) streetInp.value = street;

    var street2Inp = form.querySelector('input[name="street2"]');
    if (street2Inp && street2) street2Inp.value = street2;

    var cityInp = form.querySelector('input[name="city"]');
    if (cityInp && city) cityInp.value = city;

    var zipInp = form.querySelector('input[name="zip"]');
    if (zipInp && zip) zipInp.value = zip;

    var webInp = form.querySelector('input[name="website"]');
    if (webInp && website) webInp.value = website;

    var funcInp = form.querySelector('input[name="function"]');
    if (funcInp && fn) funcInp.value = fn;

    var countrySel = form.querySelector('select[name="country_id"]');
    if (countrySel && country) countrySel.value = country;

    var stateSel = form.querySelector('select[name="state_id"]');
    if (stateSel && state) stateSel.value = state;
}

// Expose globally for inline event attributes
window.openWonModal = openWonModal;
window.closeWonModal = closeWonModal;
window.openLostModal = openLostModal;
window.closeLostModal = closeLostModal;
window.switchTab = switchTab;
window.updateSalespersonAvatar = updateSalespersonAvatar;
window.updateTags = updateTags;
window.onPartnerChange = onPartnerChange;

function setupCrmPortalHandlers() {
    if (window.__crm_lead_detail_initialized) return;
    window.__crm_lead_detail_initialized = true;

    // Modal overlay click outside to close
    var wonModal = document.getElementById("crm_portal_won_modal");
    if (wonModal) {
        wonModal.addEventListener("click", function (e) {
            if (e.target === wonModal) closeWonModal();
        });
    }
    var lostModal = document.getElementById("crm_portal_lost_modal");
    if (lostModal) {
        lostModal.addEventListener("click", function (e) {
            if (e.target === lostModal) closeLostModal();
        });
    }

    var wonOpen = document.getElementById("crm_portal_won_open");
    var wonClose = document.getElementById("crm_portal_won_close");
    var wonCancel = document.getElementById("crm_portal_won_cancel");
    if (wonOpen) {
        wonOpen.addEventListener("click", function (e) {
            e.preventDefault();
            openWonModal();
        });
    }
    if (wonClose) wonClose.addEventListener("click", closeWonModal);
    if (wonCancel) wonCancel.addEventListener("click", closeWonModal);

    var lostOpen = document.getElementById("crm_portal_lost_open");
    var lostClose = document.getElementById("crm_portal_lost_close");
    var lostCancel = document.getElementById("crm_portal_lost_cancel");
    if (lostOpen) {
        lostOpen.addEventListener("click", function (e) {
            e.preventDefault();
            openLostModal();
        });
    }
    if (lostClose) lostClose.addEventListener("click", closeLostModal);
    if (lostCancel) lostCancel.addEventListener("click", closeLostModal);

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            closeWonModal();
            closeLostModal();
        }
    });

    // Tab switching listeners
    var tabBtns = document.querySelectorAll(".crm-tab-nav-btn");
    tabBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
            var targetId = btn.getAttribute("data-target");
            if (targetId) {
                switchTab(btn, targetId);
            }
        });
    });

    // Tag dropdown checkbox updating
    var tagCheckboxes = document.querySelectorAll(".crm-tag-input-item");
    tagCheckboxes.forEach(function (cb) {
        cb.addEventListener("change", function () {
            updateTags(cb, "lead_tags_summary_text");
            updateTags(cb, "opp_tags_summary_text");
        });
    });

    // Salesperson avatar update on select change
    var leadSelect = document.getElementById("lead_salesperson_select");
    if (leadSelect) {
        leadSelect.addEventListener("change", function () {
            updateSalespersonAvatar(leadSelect, "lead_salesperson_avatar");
        });
    }

    var oppSelect = document.getElementById("opp_salesperson_select");
    if (oppSelect) {
        oppSelect.addEventListener("change", function () {
            updateSalespersonAvatar(oppSelect, "opp_salesperson_avatar");
        });
    }

    // Priority stars interactive toggle
    var starOpts = document.querySelectorAll(".crm-star-opt");
    if (starOpts.length > 0) {
        starOpts.forEach(function (star) {
            star.addEventListener("click", function (e) {
                var val = parseInt(star.getAttribute("data-val") || 0);
                if (window.setLeadPriorityManual) {
                    window.setLeadPriorityManual(star, val);
                }
            });
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupCrmPortalHandlers);
} else {
    setupCrmPortalHandlers();
}
