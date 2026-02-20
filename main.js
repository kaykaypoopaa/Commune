import { supabase } from './supabase.js';

const { data: { session } } = await supabase.auth.getSession();
const username = session.user.user_metadata.username;

const navmenu = document.getElementById('nav-menu')

document.getElementById('settings-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = "./login/";
});

document.getElementById('username-display').innerText = username;

const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', session.user.id)
    .single();

if (profile.avatar_url) {
    document.getElementById('user-avatar').src = profile.avatar_url;
}

async function uploadAvatar(file) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise(resolve => img.onload = resolve);
    ctx.drawImage(img, 0, 0, 128, 128);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session.user.id;

    const { error } = await supabase.storage
        .from('avatars')
        .upload(`${userId}/avatar.png`, blob, { upsert: true });

    if (error) return alert(error.message);

    // get public url
    const { data } = supabase.storage.from('avatars').getPublicUrl(`${userId}/avatar.png`);
    
    // save url to profiles table
    await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);

    // update the img on screen
    document.getElementById('user-avatar').src = data.publicUrl;
}

document.getElementById('user-avatar').addEventListener('click', () => {
    document.getElementById('avatar-input').click();
});

document.getElementById('avatar-input').addEventListener('change', (e) => {
    if (e.target.files[0]) uploadAvatar(e.target.files[0]);
});