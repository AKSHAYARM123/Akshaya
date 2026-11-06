/* @odoo-module ignore */
/**
 * CRM Portal Messaging & Discuss Systray Component
 * Implements user-to-user messaging matching Reference Images 1 & 2.
 * Handles dropdown tabs, unread counts, conversation history, real-time messaging,
 * user selection, attachments, and dockable floating chat.
 */

(function () {
    'use strict';

    // State
    const ChatState = {
        currentTab: 'all',          // 'all', 'chat', 'channel'
        activeChannelId: null,      // currently selected discuss.channel ID
        activeChannelData: null,    // { id, name, avatar_url, channel_type, ... }
        pendingAttachments: [],     // [{ name, datas, mimetype }]
        floatPendingAttachments: [],
        unreadCount: 0,
        isDropdownOpen: false,
        isFloatOpen: false,
        isFloatMinimized: false,
        pollTimer: null,
    };

    // Helper: JSON-RPC Call to Odoo Controller
    async function rpcCall(endpoint, params = {}) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'call',
                    params: params
                })
            });
            const data = await response.json();
            if (data.error) {
                console.error(`[CRM Portal Chat] RPC error on ${endpoint}:`, data.error);
                return null;
            }
            return data.result;
        } catch (err) {
            console.error(`[CRM Portal Chat] Network error on ${endpoint}:`, err);
            return null;
        }
    }

    // Helper: Escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Helper: Format raw date or fallback
    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();
            if (isToday) {
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            const isThisYear = d.getFullYear() === now.getFullYear();
            if (isThisYear) {
                return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            }
            return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {
            return dateStr;
        }
    }

    // =========================================================================
    // Core Functions
    // =========================================================================

    // 1. Update Header Unread Badge (Image 1)
    async function updateUnreadCount() {
        const result = await rpcCall('/portal/chat/unread_count');
        if (!result) return;

        const count = result.unread_count || 0;
        ChatState.unreadCount = count;

        const badge = document.getElementById('crm_portal_unread_badge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.classList.remove('d-none');
            } else {
                badge.classList.add('d-none');
            }
        }

        const floatDot = document.getElementById('crm_float_unread_dot');
        if (floatDot) {
            if (count > 0 && ChatState.isFloatMinimized) {
                floatDot.classList.remove('d-none');
            } else {
                floatDot.classList.add('d-none');
            }
        }
    }

    // 2. Load Conversations List (Image 2)
    async function loadConversations(tab = ChatState.currentTab, searchTerm = '') {
        const container = document.getElementById('crm_portal_conversations_list');
        if (!container) return;

        try {
            const result = await rpcCall('/portal/chat/channels', { tab: tab, search_term: searchTerm });
            if (!result || !result.channels) {
                container.innerHTML = `
                    <div class="crm-empty-state">
                        <i class="fa fa-comments-o"></i>
                        <div class="fw-semibold">No conversations yet</div>
                        <div class="small text-muted mt-1">Click "New Message" above to start a chat!</div>
                    </div>`;
                return;
            }

            const channels = result.channels;
            if (channels.length === 0) {
                container.innerHTML = `
                    <div class="crm-empty-state">
                        <i class="fa fa-comments-o"></i>
                        <div class="fw-semibold">No conversations yet</div>
                        <div class="small text-muted mt-1">Click "New Message" above to start a chat!</div>
                    </div>`;
                return;
            }

            let html = '';
            channels.forEach(ch => {
                const isUnread = ch.unread_count > 0;
                const unreadClass = isUnread ? 'unread' : '';
                const unreadPill = isUnread ? `<span class="crm-conv-unread-pill">${ch.unread_count}</span>` : '';

                // Avatar markup
                let avatarMarkup = '';
                if (ch.channel_type === 'chat' && ch.avatar_url) {
                    avatarMarkup = `
                        <div class="crm-conv-avatar-wrap position-relative me-3">
                            <img class="crm-conv-avatar" src="${escapeHtml(ch.avatar_url)}" alt="avatar"/>
                        </div>`;
                } else {
                    avatarMarkup = `
                        <div class="crm-conv-avatar-wrap position-relative me-3">
                            <div class="crm-channel-hash-avatar">#</div>
                        </div>`;
                }

                html += `
                    <div class="crm-conv-item ${unreadClass}" data-channel-id="${ch.id}" data-channel-name="${escapeHtml(ch.name)}" data-channel-type="${escapeHtml(ch.channel_type)}" data-avatar="${escapeHtml(ch.avatar_url || '')}">
                        ${avatarMarkup}
                        <div class="crm-conv-info">
                            <div class="d-flex align-items-center justify-content-between">
                                <span class="crm-conv-title text-truncate">${escapeHtml(ch.name)}</span>
                                <span class="crm-conv-time">${escapeHtml(ch.last_date || '')}</span>
                            </div>
                            <div class="d-flex align-items-center justify-content-between mt-1">
                                <span class="crm-conv-preview text-truncate">${escapeHtml(ch.last_message || '')}</span>
                                ${unreadPill}
                            </div>
                        </div>
                    </div>`;
            });

            container.innerHTML = html;

            // Bind click on conversation items
            container.querySelectorAll('.crm-conv-item').forEach(el => {
                el.addEventListener('click', function () {
                    const channelId = parseInt(this.getAttribute('data-channel-id'), 10);
                    const channelName = this.getAttribute('data-channel-name');
                    const channelType = this.getAttribute('data-channel-type');
                    const avatarUrl = this.getAttribute('data-avatar');

                    openChannel(channelId, {
                        id: channelId,
                        name: channelName,
                        channel_type: channelType,
                        avatar_url: avatarUrl
                    });
                });
            });
        } catch (err) {
            console.error('[CRM Portal Chat] Error in loadConversations:', err);
            container.innerHTML = `
                <div class="crm-empty-state">
                    <i class="fa fa-comments-o"></i>
                    <div class="fw-semibold">No conversations yet</div>
                    <div class="small text-muted mt-1">Click "New Message" above to start a chat!</div>
                </div>`;
        }
    }

    // 3. Load Authorized Users for "New Message"
    async function loadAuthorizedUsers(searchTerm = '') {
        const container = document.getElementById('crm_portal_users_list');
        if (!container) return;

        const result = await rpcCall('/portal/chat/users', { search_term: searchTerm });
        if (!result || !result.users) {
            container.innerHTML = `
                <div class="crm-empty-state">
                    <i class="fa fa-exclamation-circle text-danger"></i>
                    <div>Unable to load users</div>
                </div>`;
            return;
        }

        const users = result.users;
        if (users.length === 0) {
            container.innerHTML = `
                <div class="crm-empty-state">
                    <i class="fa fa-user-times"></i>
                    <div>No users found</div>
                </div>`;
            return;
        }

        let html = '';
        users.forEach(u => {
            const roleClass = u.is_internal ? 'crm-role-internal' : 'crm-role-portal';
            html += `
                <div class="crm-user-item" data-partner-id="${u.partner_id}" data-user-name="${escapeHtml(u.name)}" data-avatar="${escapeHtml(u.avatar_url)}">
                    <img class="crm-user-item-avatar" src="${escapeHtml(u.avatar_url)}" alt="avatar"/>
                    <div class="flex-grow-1 min-w-0">
                        <div class="d-flex align-items-center justify-content-between">
                            <span class="fw-semibold text-truncate small text-dark">${escapeHtml(u.name)}</span>
                            <span class="crm-user-role-badge ${roleClass}">${escapeHtml(u.role_label)}</span>
                        </div>
                        <div class="small text-muted text-truncate">${escapeHtml(u.email || '')}</div>
                    </div>
                </div>`;
        });

        container.innerHTML = html;

        // Bind click on user item to start chat
        container.querySelectorAll('.crm-user-item').forEach(el => {
            el.addEventListener('click', async function () {
                const partnerId = parseInt(this.getAttribute('data-partner-id'), 10);
                const userName = this.getAttribute('data-user-name');
                const avatar = this.getAttribute('data-avatar');

                // Loading feedback
                this.style.opacity = '0.5';

                const createResult = await rpcCall('/portal/chat/get_or_create', { partner_id: partnerId });
                if (createResult && createResult.success && createResult.channel) {
                    const ch = createResult.channel;
                    openChannel(ch.id, ch);
                } else {
                    alert('Unable to start conversation. Please try again.');
                    this.style.opacity = '1';
                }
            });
        });
    }

    // 4. Open Channel & Load Thread
    async function openChannel(channelId, channelData = null) {
        ChatState.activeChannelId = channelId;
        if (channelData) {
            ChatState.activeChannelData = channelData;
        }

        // Show Thread Pane in Dropdown
        showPane('thread');

        // Update Thread Header
        const threadTitle = document.getElementById('crm_thread_title');
        const threadAvatar = document.getElementById('crm_thread_avatar');
        const threadSubtitle = document.getElementById('crm_thread_subtitle');

        if (ChatState.activeChannelData) {
            if (threadTitle) threadTitle.textContent = ChatState.activeChannelData.name;
            if (threadAvatar) {
                threadAvatar.src = ChatState.activeChannelData.avatar_url || '/web/static/img/user_placeholder.jpg';
            }
            if (threadSubtitle) {
                threadSubtitle.textContent = ChatState.activeChannelData.channel_type === 'chat' ? 'Direct Message' : 'Channel';
            }
        }

        // Also sync Floating widget header if open
        syncFloatHeader();

        // Load Messages
        await fetchChannelMessages(channelId);

        // Update unread count
        updateUnreadCount();
    }

    // 5. Fetch Messages History
    async function fetchChannelMessages(channelId, appendOnly = false) {
        const messagesContainer = document.getElementById('crm_thread_messages');
        const floatMessagesContainer = document.getElementById('crm_float_messages');

        const result = await rpcCall('/portal/chat/messages', {
            channel_id: channelId,
            limit: 60,
            mark_as_read: true
        });

        if (!result || !result.success) return;

        if (result.channel) {
            ChatState.activeChannelData = result.channel;
        }

        const messages = result.messages || [];
        const html = renderMessagesList(messages);

        if (messagesContainer) {
            messagesContainer.innerHTML = html;
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        if (floatMessagesContainer) {
            floatMessagesContainer.innerHTML = html;
            floatMessagesContainer.scrollTop = floatMessagesContainer.scrollHeight;
        }
    }

    // Helper: Render Messages HTML
    function renderMessagesList(messages) {
        if (!messages || messages.length === 0) {
            return `
                <div class="text-center py-5 text-muted">
                    <i class="fa fa-hand-peace-o fs-3 mb-2 text-primary opacity-75"></i>
                    <div class="small fw-semibold">No messages yet. Say hello!</div>
                </div>`;
        }

        let html = '';
        messages.forEach(msg => {
            const rowClass = msg.is_me ? 'crm-msg-out' : 'crm-msg-in';
            const senderName = (!msg.is_me && ChatState.activeChannelData && ChatState.activeChannelData.channel_type !== 'chat')
                ? `<div class="crm-msg-sender">${escapeHtml(msg.author_name)}</div>`
                : '';

            // Attachments markup
            let attachMarkup = '';
            if (msg.attachments && msg.attachments.length > 0) {
                msg.attachments.forEach(att => {
                    if (att.is_image) {
                        attachMarkup += `<a href="${escapeHtml(att.url)}" target="_blank" class="d-block"><img src="${escapeHtml(att.image_url)}" class="crm-msg-img-preview" alt="${escapeHtml(att.name)}"/></a>`;
                    } else {
                        attachMarkup += `<a href="${escapeHtml(att.url)}" target="_blank" class="crm-msg-attachment-item"><i class="fa fa-paperclip"></i><span class="text-truncate" style="max-width: 160px;">${escapeHtml(att.name)}</span></a>`;
                    }
                });
            }

            const cleanBody = (msg.body || '').trim();
            const bodyHtml = cleanBody ? escapeHtml(cleanBody) : '';
            const bubbleContent = (bodyHtml && attachMarkup)
                ? `${bodyHtml}<div class="mt-1">${attachMarkup}</div>`
                : (bodyHtml || attachMarkup);

            html += `
                <div class="crm-msg-row ${rowClass}" data-msg-id="${msg.id}">
                    ${senderName}
                    <div class="crm-msg-bubble">${bubbleContent}</div>
                    <div class="crm-msg-meta">${escapeHtml(msg.date || '')}</div>
                </div>`;
        });

        return html;
    }

    // 6. Send Message Function
    async function sendMessage(inputEl, fileInputEl, previewBarEl) {
        if (!ChatState.activeChannelId) return;

        const text = inputEl ? inputEl.value.trim() : '';
        const attachments = (inputEl && inputEl.id.includes('float')) ? ChatState.floatPendingAttachments : ChatState.pendingAttachments;

        if (!text && attachments.length === 0) return;

        // Disable input while sending
        if (inputEl) inputEl.disabled = true;

        const result = await rpcCall('/portal/chat/send', {
            channel_id: ChatState.activeChannelId,
            message: text,
            attachments: attachments
        });

        if (inputEl) {
            inputEl.disabled = false;
            inputEl.value = '';
            inputEl.focus();
        }

        // Clear pending attachments
        if (inputEl && inputEl.id.includes('float')) {
            ChatState.floatPendingAttachments = [];
        } else {
            ChatState.pendingAttachments = [];
        }
        if (previewBarEl) {
            previewBarEl.innerHTML = '';
            previewBarEl.classList.add('d-none');
        }
        if (fileInputEl) fileInputEl.value = '';

        if (result && result.success) {
            // Re-fetch messages immediately
            await fetchChannelMessages(ChatState.activeChannelId);
            // Refresh conversation previews in list
            loadConversations();
            updateUnreadCount();
        } else {
            alert(result && result.error ? result.error : 'Failed to send message');
        }
    }

    // 7. Navigation between Panes in Dropdown
    function showPane(paneName) {
        const paneConv = document.getElementById('crm_pane_conversations');
        const paneNew = document.getElementById('crm_pane_new_msg');
        const paneThread = document.getElementById('crm_pane_thread');

        if (paneConv) paneConv.classList.add('d-none');
        if (paneNew) paneNew.classList.add('d-none');
        if (paneThread) paneThread.classList.add('d-none');

        if (paneName === 'conversations') {
            if (paneConv) paneConv.classList.remove('d-none');
            loadConversations();
        } else if (paneName === 'new_msg') {
            if (paneNew) paneNew.classList.remove('d-none');
            loadAuthorizedUsers();
            const searchInput = document.getElementById('crm_user_search_input');
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
        } else if (paneName === 'thread') {
            if (paneThread) paneThread.classList.remove('d-none');
            const msgInput = document.getElementById('crm_dropdown_msg_input');
            if (msgInput) msgInput.focus();
        }
    }

    // 8. Floating Chat Widget Management
    function syncFloatHeader() {
        const floatTitle = document.getElementById('crm_float_title');
        const floatAvatar = document.getElementById('crm_float_avatar');
        const floatSubtitle = document.getElementById('crm_float_subtitle');
        const pillName = document.getElementById('crm_minimized_pill_name');

        if (ChatState.activeChannelData) {
            if (floatTitle) floatTitle.textContent = ChatState.activeChannelData.name;
            if (pillName) pillName.textContent = ChatState.activeChannelData.name;
            if (floatAvatar) {
                floatAvatar.src = ChatState.activeChannelData.avatar_url || '/web/static/img/user_placeholder.jpg';
            }
            if (floatSubtitle) {
                floatSubtitle.textContent = ChatState.activeChannelData.channel_type === 'chat' ? 'Direct Message' : 'Channel';
            }
        }
    }

    function openFloatingWidget() {
        if (!ChatState.activeChannelId) return;

        ChatState.isFloatOpen = true;
        ChatState.isFloatMinimized = false;

        const widget = document.getElementById('crm_floating_chat_widget');
        const pill = document.getElementById('crm_float_minimized_pill');

        if (widget) widget.classList.remove('d-none');
        if (pill) pill.classList.add('d-none');

        syncFloatHeader();
        fetchChannelMessages(ChatState.activeChannelId);

        // Close header dropdown to avoid duplicates
        const dropdownMenu = document.getElementById('portalMessagesDropdownMenu');
        const dropdownToggle = document.getElementById('portalMessagesDropdownToggle');
        if (dropdownMenu && dropdownToggle) {
            dropdownMenu.classList.remove('show');
            dropdownToggle.classList.remove('show');
            dropdownToggle.setAttribute('aria-expanded', 'false');
        }
    }

    function minimizeFloatingWidget() {
        ChatState.isFloatMinimized = true;
        const widget = document.getElementById('crm_floating_chat_widget');
        const pill = document.getElementById('crm_float_minimized_pill');

        if (widget) widget.classList.add('d-none');
        if (pill) pill.classList.remove('d-none');
    }

    function closeFloatingWidget() {
        ChatState.isFloatOpen = false;
        ChatState.isFloatMinimized = false;
        const widget = document.getElementById('crm_floating_chat_widget');
        const pill = document.getElementById('crm_float_minimized_pill');

        if (widget) widget.classList.add('d-none');
        if (pill) pill.classList.add('d-none');
    }

    // 9. Handle File Attachment Reading
    function handleFileSelection(fileInput, previewBar, isFloat = false) {
        const files = Array.from(fileInput.files);
        if (!files.length) return;

        const targetList = isFloat ? ChatState.floatPendingAttachments : ChatState.pendingAttachments;

        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const base64Data = e.target.result.split(',')[1];
                const fileObj = {
                    name: file.name,
                    datas: base64Data,
                    mimetype: file.type
                };
                targetList.push(fileObj);

                // Add preview tag
                previewBar.classList.remove('d-none');
                const tag = document.createElement('span');
                tag.className = 'crm-attach-tag';
                tag.innerHTML = `
                    <i class="fa fa-file-o"></i>
                    <span class="text-truncate" style="max-width: 100px;">${escapeHtml(file.name)}</span>
                    <span class="crm-attach-tag-remove" title="Remove">&times;</span>`;

                tag.querySelector('.crm-attach-tag-remove').addEventListener('click', () => {
                    const idx = targetList.indexOf(fileObj);
                    if (idx > -1) targetList.splice(idx, 1);
                    tag.remove();
                    if (targetList.length === 0) {
                        previewBar.classList.add('d-none');
                    }
                });

                previewBar.appendChild(tag);
            };
            reader.readAsDataURL(file);
        });
    }

    // =========================================================================
    // Initialization & Event Listeners
    // =========================================================================

    function initPortalMessaging() {
        const toggle = document.getElementById('portalMessagesDropdownToggle');
        if (!toggle) {
            // User is not logged in or element not rendered
            return;
        }

        console.log("[CRM Portal] Initializing Discuss Messaging systray...");

        // Initial unread count fetch
        updateUnreadCount();

        // Pre-fetch conversations list immediately on load so it's ready without delay
        loadConversations();

        // Bootstrap 5 dropdown show/shown event listeners on dropdown wrapper
        const dropdownItem = toggle.closest('.o_crm_portal_messages_item') || toggle;
        dropdownItem.addEventListener('show.bs.dropdown', function () {
            if (ChatState.activeChannelId) {
                showPane('thread');
                fetchChannelMessages(ChatState.activeChannelId);
            } else {
                showPane('conversations');
            }
        });

        // Dropdown toggle click listener (ensures execution regardless of Bootstrap timing)
        toggle.addEventListener('click', function () {
            setTimeout(function () {
                if (ChatState.activeChannelId) {
                    showPane('thread');
                    fetchChannelMessages(ChatState.activeChannelId);
                } else {
                    showPane('conversations');
                }
            }, 30);
        });

        // Tabs click (All / Chats / Channels)
        document.querySelectorAll('.crm-tab-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                document.querySelectorAll('.crm-tab-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                ChatState.currentTab = this.getAttribute('data-tab');
                loadConversations(ChatState.currentTab);
            });
        });

        // "New Message" button click
        const newMsgBtn = document.getElementById('crm_new_msg_btn');
        if (newMsgBtn) {
            newMsgBtn.addEventListener('click', function (e) {
                e.preventDefault();
                showPane('new_msg');
            });
        }

        // "Back to Conversations" buttons
        document.querySelectorAll('.crm-back-to-list-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                ChatState.activeChannelId = null;
                ChatState.activeChannelData = null;
                showPane('conversations');
            });
        });

        // Close buttons in dropdown panes
        document.querySelectorAll('.crm-close-dropdown-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const dropdownMenu = document.getElementById('portalMessagesDropdownMenu');
                const dropdownToggle = document.getElementById('portalMessagesDropdownToggle');
                if (dropdownMenu && dropdownToggle) {
                    dropdownMenu.classList.remove('show');
                    dropdownToggle.classList.remove('show');
                    dropdownToggle.setAttribute('aria-expanded', 'false');
                }
            });
        });

        // Pop out / Dock button (transitions thread to floating widget)
        const dockBtn = document.getElementById('crm_dock_float_btn');
        if (dockBtn) {
            dockBtn.addEventListener('click', function (e) {
                e.preventDefault();
                openFloatingWidget();
            });
        }

        // Floating widget Minimize & Close
        const floatMinBtn = document.getElementById('crm_float_minimize_btn');
        if (floatMinBtn) {
            floatMinBtn.addEventListener('click', minimizeFloatingWidget);
        }

        const floatCloseBtn = document.getElementById('crm_float_close_btn');
        if (floatCloseBtn) {
            floatCloseBtn.addEventListener('click', closeFloatingWidget);
        }

        const floatPill = document.getElementById('crm_float_minimized_pill');
        if (floatPill) {
            floatPill.addEventListener('click', openFloatingWidget);
        }

        // Channel search filter input
        const channelSearch = document.getElementById('crm_channel_search_input');
        if (channelSearch) {
            let debounceTimer = null;
            channelSearch.addEventListener('input', function () {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    loadConversations(ChatState.currentTab, this.value);
                }, 250);
            });
        }

        // User search filter input
        const userSearch = document.getElementById('crm_user_search_input');
        if (userSearch) {
            let debounceTimer = null;
            userSearch.addEventListener('input', function () {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    loadAuthorizedUsers(this.value);
                }, 250);
            });
        }

        // Dropdown message submit
        const dropdownMsgForm = document.getElementById('crm_dropdown_msg_form');
        const dropdownMsgInput = document.getElementById('crm_dropdown_msg_input');
        const dropdownFileInput = document.getElementById('crm_dropdown_file_input');
        const dropdownPreviewBar = document.getElementById('crm_attach_preview_bar');

        if (dropdownMsgForm) {
            dropdownMsgForm.addEventListener('submit', function (e) {
                e.preventDefault();
                sendMessage(dropdownMsgInput, dropdownFileInput, dropdownPreviewBar);
            });
        }

        if (dropdownFileInput) {
            dropdownFileInput.addEventListener('change', function () {
                handleFileSelection(this, dropdownPreviewBar, false);
            });
        }

        // Floating message submit
        const floatMsgForm = document.getElementById('crm_float_msg_form');
        const floatMsgInput = document.getElementById('crm_float_msg_input');
        const floatFileInput = document.getElementById('crm_float_file_input');
        const floatPreviewBar = document.getElementById('crm_float_attach_preview_bar');

        if (floatMsgForm) {
            floatMsgForm.addEventListener('submit', function (e) {
                e.preventDefault();
                sendMessage(floatMsgInput, floatFileInput, floatPreviewBar);
            });
        }

        if (floatFileInput) {
            floatFileInput.addEventListener('change', function () {
                handleFileSelection(this, floatPreviewBar, true);
            });
        }

        // Periodic Background Poller (every 5 seconds)
        ChatState.pollTimer = setInterval(async () => {
            // Update unread badge in header
            await updateUnreadCount();

            // If an active channel thread is currently open and visible, poll for incoming messages
            if (ChatState.activeChannelId) {
                const paneThread = document.getElementById('crm_pane_thread');
                const isDropdownThreadVisible = paneThread && !paneThread.classList.contains('d-none');
                const isFloatVisible = ChatState.isFloatOpen && !ChatState.isFloatMinimized;

                if (isDropdownThreadVisible || isFloatVisible) {
                    await fetchChannelMessages(ChatState.activeChannelId);
                }
            }
        }, 5000);
    }

    // Auto-init on document ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPortalMessaging);
    } else {
        initPortalMessaging();
    }

})();
