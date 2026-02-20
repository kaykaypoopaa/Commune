import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabase = createClient('https://hgarhuhvxjwdftskpdzq.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnYXJodWh2eGp3ZGZ0c2twZHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc2OTgsImV4cCI6MjA4NzA0MzY5OH0.a9jkcDbe1AKNw83H1wRvo5MZieSpiqMHeNe_Xx9pqdI')

let isLogin = true;

async function handleAuth() {
    const username = document.getElementById('username').value;
    const pass = document.getElementById('password').value;

    if (username.length < 3 || pass.length < 3) return alert("Too short!");

    const email = `${username}@gmail.com`;

    if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) alert(error.message);
        else window.location.href = "../index.html";
    } else {
        const { error } = await supabase.auth.signUp({ email, password: pass,
            options: { data: { username } }
        });
        if (error) alert(error.message);
        else alert("Account created! Logging you in...");
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (loginError) alert(loginError.message);
        else window.location.href = "../index.html";
    }
}

function toggleMode() {
    isLogin = !isLogin;
    const title = document.getElementById('title');
    const subtitle = document.getElementById('subtitle');
    const btn = document.getElementById('main-btn');
    const link = document.getElementById('toggle-link');
    const toggleText = document.getElementById('toggle-text');

    if (isLogin) {
        title.innerText = "Welcome back!";
        subtitle.innerText = "We're so excited to see you again!";
        btn.innerText = "Log In";
        toggleText.innerText = "Need an account?";
        link.innerText = "Register";
    } else {
        title.innerText = "Create an account";
        subtitle.innerText = "Join the Commune community!";
        btn.innerText = "Continue";
        toggleText.innerText = "Already have an account?";
        link.innerText = "Login";
    }
}

window.handleAuth = handleAuth;
window.toggleMode = toggleMode;