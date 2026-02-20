import { supabase } from './supabase.js';

const { data: { session } } = await supabase.auth.getSession();
if (!session) {
    window.location.href = "./login/";
} else {
    document.body.style.display = "block";
}