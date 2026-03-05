import { supabase } from './supabase.js';

const { data: { session } } = await supabase.auth.getSession();
const username = session.user.user_metadata.username;
const userId   = session.user.id;

// ── Auth listener ─────────────────────────────────────
supabase.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_OUT' || !s) window.location.href = './login/';
});

document.getElementById('settings-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = './login/';
});

// ── Profile ───────────────────────────────────────────
document.getElementById('username-display').textContent = username;

const { data: profile } = await supabase
    .from('profiles').select('avatar_url').eq('id', userId).single();
if (profile?.avatar_url)
    document.getElementById('user-avatar').src = profile.avatar_url;

async function uploadAvatar(file) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise(r => img.onload = r);
    ctx.drawImage(img, 0, 0, 128, 128);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));

    const { error } = await supabase.storage
        .from('avatars').upload(`${userId}/avatar.png`, blob, { upsert: true });
    if (error) return alert(error.message);

    const { data } = supabase.storage.from('avatars').getPublicUrl(`${userId}/avatar.png`);
    await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
    document.getElementById('user-avatar').src = data.publicUrl;
}

document.getElementById('user-avatar').addEventListener('click', () =>
    document.getElementById('avatar-input').click());
document.getElementById('avatar-input').addEventListener('change', e => {
    if (e.target.files[0]) uploadAvatar(e.target.files[0]);
});

// ── State ─────────────────────────────────────────────
let currentGuild   = null;
let currentChannel = null;
let isOwner        = false;   // is current user the guild owner?
let typingChannel  = null;
const typingUsers  = new Set();
let typingTimeout  = null;

// ── Context menu helpers ──────────────────────────────
let ctxTargetChannel = null;
let ctxTargetMessage = null;

function openCtx(menu, x, y) {
    closeAllCtx();
    menu.style.left = `${Math.min(x, window.innerWidth  - menu.offsetWidth  - 8)}px`;
    menu.style.top  = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
    menu.classList.add('open');
    // Recalculate after it's visible
    requestAnimationFrame(() => {
        menu.style.left = `${Math.min(x, window.innerWidth  - menu.offsetWidth  - 8)}px`;
        menu.style.top  = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
    });
}

function closeAllCtx() {
    document.querySelectorAll('.context-menu').forEach(m => m.classList.remove('open'));
}

document.addEventListener('click',  closeAllCtx);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllCtx(); });

// ── Channel context menu ──────────────────────────────
const channelCtx = document.getElementById('channel-ctx');

document.getElementById('ctx-rename-channel').addEventListener('click', () => {
    if (!ctxTargetChannel) return;
    openModal('rename-channel-overlay');
    const input = document.getElementById('rename-channel-input');
    input.value = ctxTargetChannel.name;
    input.focus();
    input.select();
});

document.getElementById('ctx-delete-channel').addEventListener('click', async () => {
    if (!ctxTargetChannel) return;
    if (!confirm(`Delete #${ctxTargetChannel.name}? This cannot be undone.`)) return;
    const { error } = await supabase.from('channels').delete().eq('id', ctxTargetChannel.id);
    if (error) return alert(error.message);

    // Remove from sidebar
    const item = document.querySelector(`[data-channel-id="${ctxTargetChannel.id}"]`);
    if (item) item.remove();

    if (currentChannel?.id === ctxTargetChannel.id) {
        currentChannel = null;
        document.getElementById('chat-header').textContent = 'Select a channel';
        document.getElementById('message-list').innerHTML = '';
        document.getElementById('message-input').disabled = true;
        document.getElementById('send-btn').disabled = true;
    }
    ctxTargetChannel = null;
});

// ── Message context menu ──────────────────────────────
const messageCtx = document.getElementById('message-ctx');

document.getElementById('ctx-delete-message').addEventListener('click', async () => {
    if (!ctxTargetMessage) return;
    const { error } = await supabase
        .from('messages').delete().eq('id', ctxTargetMessage.dataset.messageId);
    if (error) return alert(error.message);
    ctxTargetMessage.remove();
    ctxTargetMessage = null;
});

// ── Modal helpers ─────────────────────────────────────
function openModal(id) {
    document.getElementById(id).classList.add('open');
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
    });
});

// ── Guilds ────────────────────────────────────────────
const { data: guilds } = await supabase.from('guilds').select('*');
guilds?.forEach(g => addGuildIcon(g));

function addGuildIcon(guild) {
    const icon = document.createElement('div');
    icon.className = 'guild-icon';
    icon.title = guild.name;
    icon.dataset.guildId = guild.id;
    icon.textContent = guild.icon_url ? '' : guild.name.slice(0, 2).toUpperCase();
    if (guild.icon_url) icon.innerHTML = `<img src="${guild.icon_url}" alt="${guild.name}">`;
    icon.addEventListener('click', () => selectGuild(guild, icon));
    document.getElementById('guild-list').appendChild(icon);
}

async function selectGuild(guild, iconEl) {
    currentGuild = guild;
    isOwner = guild.owner_id === userId;

    document.querySelectorAll('.guild-icon').forEach(el => el.classList.remove('active'));
    iconEl.classList.add('active');
    document.getElementById('sidebar-guild-name').textContent = guild.name;

    // Show/hide add channel button for owners only
    document.getElementById('add-channel-btn').style.display = isOwner ? 'block' : 'none';

    await loadChannels(guild.id);
}

// ── Channels ──────────────────────────────────────────
async function loadChannels(guildId) {
    const { data: channels } = await supabase
        .from('channels').select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: true });

    const list = document.getElementById('channel-list');
    list.innerHTML = '';
    channels?.forEach(c => addChannelToSidebar(c));

    if (channels?.length > 0) {
        list.querySelector('.channel-item')?.click();
    } else {
        document.getElementById('message-list').innerHTML = '';
        document.getElementById('chat-header').textContent = 'No channels yet';
        document.getElementById('message-input').disabled = true;
        document.getElementById('send-btn').disabled = true;
    }
}

function addChannelToSidebar(channel) {
    const div = document.createElement('div');
    div.className = 'channel-item';
    div.dataset.channelId = channel.id;
    div.innerHTML = `
        <div class="channel-item-name">
            <span class="channel-item-text">${channel.name}</span>
        </div>
    `;

    div.addEventListener('click', () => {
        document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
        selectChannel(channel);
    });

    // Right-click context menu (owners only)
    div.addEventListener('contextmenu', e => {
        if (!isOwner) return;
        e.preventDefault();
        ctxTargetChannel = channel;
        openCtx(channelCtx, e.clientX, e.clientY);
    });

    document.getElementById('channel-list').appendChild(div);
}

// ── Add channel ───────────────────────────────────────
document.getElementById('add-channel-btn').addEventListener('click', () => {
    document.getElementById('channel-name-input').value = '';
    openModal('add-channel-overlay');
    document.getElementById('channel-name-input').focus();
});

document.getElementById('add-channel-cancel').addEventListener('click', () =>
    closeModal('add-channel-overlay'));

document.getElementById('add-channel-confirm').addEventListener('click', addChannel);
document.getElementById('channel-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addChannel();
});

async function addChannel() {
    const raw  = document.getElementById('channel-name-input').value.trim();
    const name = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!name || !currentGuild) return;

    const { data: channel, error } = await supabase
        .from('channels')
        .insert({ name, guild_id: currentGuild.id })
        .select().single();

    if (error) return alert(error.message);
    closeModal('add-channel-overlay');
    addChannelToSidebar(channel);
}

// ── Rename channel ────────────────────────────────────
document.getElementById('rename-channel-cancel').addEventListener('click', () =>
    closeModal('rename-channel-overlay'));

document.getElementById('rename-channel-confirm').addEventListener('click', renameChannel);
document.getElementById('rename-channel-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') renameChannel();
});

async function renameChannel() {
    if (!ctxTargetChannel) return;
    const raw  = document.getElementById('rename-channel-input').value.trim();
    const name = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!name) return;

    const { error } = await supabase
        .from('channels').update({ name }).eq('id', ctxTargetChannel.id);
    if (error) return alert(error.message);

    // Update sidebar text
    const item = document.querySelector(`[data-channel-id="${ctxTargetChannel.id}"] .channel-item-text`);
    if (item) item.textContent = name;

    // Update chat header if this channel is open
    if (currentChannel?.id === ctxTargetChannel.id) {
        currentChannel.name = name;
        document.getElementById('chat-header').textContent = name;
        document.getElementById('message-input').placeholder = `Message #${name}`;
    }

    ctxTargetChannel.name = name;
    closeModal('rename-channel-overlay');
}

// ── Select channel ────────────────────────────────────
async function selectChannel(channel) {
    currentChannel = channel;
    document.getElementById('chat-header').textContent = channel.name;
    document.getElementById('message-input').placeholder = `Message #${channel.name}`;
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;
    typingUsers.clear();
    updateTypingIndicator();
    setupRealtimeForChannel(channel.id);
    await loadMessages(channel.id);
}

// ── Messages ──────────────────────────────────────────
async function loadMessages(channelId) {
    const { data: messages } = await supabase
        .from('messages')
        .select('id, content, created_at, user_id, profiles(username, avatar_url)')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true });

    const list = document.getElementById('message-list');
    list.innerHTML = '';
    messages?.forEach(msg => renderMessage(msg));
}

function renderMessage(msg) {
    const isOwn = msg.user_id === userId;
    const div = document.createElement('div');
    div.className = 'message';
    div.dataset.messageId = msg.id;
    div.innerHTML = `
        <img src="${msg.profiles?.avatar_url || 'https://placehold.co/36x36'}" class="avatar">
        <div class="message-body">
            <div class="message-meta">
                <span class="message-author">${msg.profiles?.username ?? 'Unknown'}</span>
                <span class="message-time">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div class="message-content">${msg.content}</div>
        </div>
    `;

    // Right-click to delete own messages
    if (isOwn) {
        div.addEventListener('contextmenu', e => {
            e.preventDefault();
            ctxTargetMessage = div;
            openCtx(messageCtx, e.clientX, e.clientY);
        });
    }

    const list = document.getElementById('message-list');
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
}

// ── Send message ──────────────────────────────────────
document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    if (!currentChannel) return;
    const input   = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    await supabase.from('messages').insert({
        content, channel_id: currentChannel.id, user_id: userId,
    });
}

// ── Typing indicator ──────────────────────────────────
function updateTypingIndicator() {
    const el     = document.getElementById('typing-indicator');
    const others = [...typingUsers].filter(u => u !== username);
    if      (others.length === 0) el.textContent = '';
    else if (others.length === 1) el.textContent = `${others[0]} is typing...`;
    else if (others.length === 2) el.textContent = `${others[0]} and ${others[1]} are typing...`;
    else                          el.textContent = 'Several people are typing...';
}

document.getElementById('message-input').addEventListener('input', () => {
    if (!currentChannel || !typingChannel) return;
    clearTimeout(typingTimeout);
    typingChannel.send({ type: 'broadcast', event: 'typing', payload: { username } });
    typingTimeout = setTimeout(() => {}, 3000);
});

// ── Realtime ──────────────────────────────────────────
function setupRealtimeForChannel(channelId) {
    if (typingChannel) supabase.removeChannel(typingChannel);

    typingChannel = supabase.channel(`room:${channelId}`)
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'messages',
            filter: `channel_id=eq.${channelId}`
        }, async payload => {
            const { data: msg } = await supabase
                .from('messages')
                .select('id, content, created_at, user_id, profiles(username, avatar_url)')
                .eq('id', payload.new.id).single();
            if (msg) renderMessage(msg);
        })
        .on('postgres_changes', {
            event: 'DELETE', schema: 'public', table: 'messages'
        }, payload => {
            const el = document.querySelector(`[data-message-id="${payload.old.id}"]`);
            if (el) el.remove();
        })
        .on('broadcast', { event: 'typing' }, payload => {
            const who = payload.payload.username;
            if (who === username) return;
            typingUsers.add(who);
            updateTypingIndicator();
            setTimeout(() => { typingUsers.delete(who); updateTypingIndicator(); }, 3000);
        })
        .subscribe();
}

// ── Create guild modal ────────────────────────────────
const overlay = document.getElementById('modal-overlay');

document.getElementById('create-guild-btn').addEventListener('click', () => {
    openModal('modal-overlay');
    document.getElementById('guild-name-input').focus();
});
document.getElementById('modal-cancel').addEventListener('click', () =>
    closeModal('modal-overlay'));
document.getElementById('modal-create').addEventListener('click', createGuild);
document.getElementById('guild-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') createGuild();
});

async function createGuild() {
    const name = document.getElementById('guild-name-input').value.trim();
    if (!name) return;

    const { data: guild, error } = await supabase
        .from('guilds').insert({ name, owner_id: userId }).select().single();
    if (error) return alert(error.message);

    await supabase.from('guild_members').insert({ guild_id: guild.id, user_id: userId });
    await supabase.from('channels').insert({ name: 'general', guild_id: guild.id });

    closeModal('modal-overlay');
    document.getElementById('guild-name-input').value = '';
    addGuildIcon(guild);

    const newIcon = document.querySelector(`[data-guild-id="${guild.id}"]`);
    if (newIcon) selectGuild(guild, newIcon);
}

// ── Home button ───────────────────────────────────────
document.getElementById('home-btn').addEventListener('click', () => {
    document.querySelectorAll('.guild-icon').forEach(el => el.classList.remove('active'));
    document.getElementById('home-btn').classList.add('active');
    document.getElementById('sidebar-guild-name').textContent = 'Channels';
    document.getElementById('add-channel-btn').style.display = 'none';
    document.getElementById('channel-list').innerHTML = '';
    document.getElementById('message-list').innerHTML = '';
    document.getElementById('chat-header').textContent = 'Select a channel';
    document.getElementById('message-input').disabled = true;
    document.getElementById('send-btn').disabled = true;
    currentGuild = null; currentChannel = null;
});

// ── Auto-select first guild ───────────────────────────
if (guilds?.length > 0) {
    const firstIcon = document.querySelector('.guild-icon:not(.guild-home):not(.guild-add)');
    if (firstIcon) {
        document.getElementById('home-btn').classList.remove('active');
        selectGuild(guilds[0], firstIcon);
    }
}

// ── Join guild ────────────────────────────────────────
document.getElementById('join-guild-btn').addEventListener('click', () => {
    document.getElementById('join-code-input').value = '';
    openModal('join-guild-overlay');
    document.getElementById('join-code-input').focus();
});

document.getElementById('join-cancel').addEventListener('click', () =>
    closeModal('join-guild-overlay'));

document.getElementById('join-confirm').addEventListener('click', joinGuild);
document.getElementById('join-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGuild();
});

async function joinGuild() {
    const code = document.getElementById('join-code-input').value.trim().toLowerCase();
    if (!code) return;

    // Look up guild by invite code
    const { data: guild, error } = await supabase
        .from('guilds')
        .select('*')
        .eq('invite_code', code)
        .single();

    if (error || !guild) {
        alert('Invalid invite code — double check and try again.');
        return;
    }

    // Check if already a member
    const { data: existing } = await supabase
        .from('guild_members')
        .select('guild_id')
        .eq('guild_id', guild.id)
        .eq('user_id', userId)
        .single();

    if (existing) {
        alert('You\'re already in that server!');
        closeModal('join-guild-overlay');
        return;
    }

    // Join
    const { error: joinError } = await supabase
        .from('guild_members')
        .insert({ guild_id: guild.id, user_id: userId });

    if (joinError) return alert(joinError.message);

    closeModal('join-guild-overlay');
    document.getElementById('join-code-input').value = '';

    addGuildIcon(guild);
    const newIcon = document.querySelector(`[data-guild-id="${guild.id}"]`);
    if (newIcon) selectGuild(guild, newIcon);
}

// ── Invite code (right-click guild icon) ─────────────
document.getElementById('guild-list').addEventListener('contextmenu', async e => {
    const icon = e.target.closest('.guild-icon[data-guild-id]');
    if (!icon) return;
    e.preventDefault();

    const guildId = icon.dataset.guildId;
    const { data: guild } = await supabase
        .from('guilds').select('invite_code').eq('id', guildId).single();

    if (!guild) return;
    document.getElementById('invite-code-display').textContent = guild.invite_code;
    openModal('invite-overlay');
});

document.getElementById('invite-close').addEventListener('click', () =>
    closeModal('invite-overlay'));

document.getElementById('copy-invite-btn').addEventListener('click', () => {
    const code = document.getElementById('invite-code-display').textContent;
    navigator.clipboard.writeText(code);
    const btn = document.getElementById('copy-invite-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
    }, 2000);
});