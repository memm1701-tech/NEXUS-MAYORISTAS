const fs = require('fs');
const path = 'c:\\NEXUS-MAYORISTA\\index.html';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split(/\r?\n/);

// Find where <script type="module"> starts
const scriptIndex = lines.findIndex(line => line.includes('<script type="module">'));
if (scriptIndex === -1) {
    console.error('No se encontró script module');
    process.exit(1);
}

const newLines = lines.slice(0, scriptIndex);
newLines.push(`<script>
    document.addEventListener('DOMContentLoaded', () => {
        const loadingContainer = document.getElementById('app-loading');
        const appContent = document.getElementById('app-content');
        const loginForm = document.getElementById('login-form');
        const cashierLoginForm = document.getElementById('cashier-login-form');
        const registerCompanyForm = document.getElementById('register-company-form');
        const forgotPasswordForm = document.getElementById('forgot-password-form');
        const forgotPasswordModal = document.getElementById('forgot-password-modal');
        const messageBox = document.getElementById('message-box');

        document.getElementById('btn-tour-inventario')?.addEventListener('click', () => toggleForms('tour-inventario'));
        document.getElementById('btn-tour-modulos')?.addEventListener('click', () => toggleForms('tour-modulos'));
        document.getElementById('btn-tour-reportes')?.addEventListener('click', () => toggleForms('tour-reportes'));
        document.getElementById('btn-tour-soporte')?.addEventListener('click', () => toggleForms('tour-soporte'));

        document.querySelectorAll('.btn-return-login').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleForms('login');
            });
        });

        if (loadingContainer) loadingContainer.classList.add('hidden');
        mostrarLogin();

        function mostrarLogin() {
            if (appContent) appContent.classList.remove('hidden');
            toggleForms('login');
            document.body.style.display = 'block'; 
        }

        function toggleForms(target) {
            const containers = [
                'login-container', 'register-container', 'register-company-container', 
                'cashier-login-container', 'tour-inventario-container', 'tour-modulos-container', 
                'tour-reportes-container', 'tour-soporte-container'
            ];
            containers.forEach(c => {
                const el = document.getElementById(c);
                if (el) el.classList.add('hidden');
            });
            const targetEl = document.getElementById(target + '-container');
            if (targetEl) targetEl.classList.remove('hidden');
        }

        function showMessage(msg, type) {
            if (!messageBox) return;
            const div = document.createElement('div');
            div.className = \`p-3 mb-2 rounded text-white font-bold shadow-lg \${type === 'success' ? 'bg-green-500' : 'bg-red-500'}\`;
            div.textContent = msg;
            messageBox.appendChild(div);
            setTimeout(() => div.remove(), 3000);
        }

        function closeModal() {
            if (forgotPasswordModal) forgotPasswordModal.classList.add('hidden');
            const verifyModal = document.getElementById('verify-email-modal');
            if (verifyModal) verifyModal.classList.add('hidden');
        }

        document.getElementById('show-register-company')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms('register-company'); });
        document.getElementById('show-cashier-login')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms('cashier-login'); });
        document.getElementById('show-login')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms('login'); });
        document.getElementById('show-login-from-company-register')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms('login'); });
        document.getElementById('show-login-from-cashier-login')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms('login'); });
        document.getElementById('show-forgot-password-modal')?.addEventListener('click', (e) => { e.preventDefault(); if (forgotPasswordModal) forgotPasswordModal.classList.remove('hidden'); });
        document.getElementById('close-forgot-password-modal')?.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
        document.getElementById('close-verify-email-modal')?.addEventListener('click', (e) => { e.preventDefault(); closeModal(); toggleForms('login'); });

        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                showMessage('Login simulado exitoso', 'success');
                if (window.nexusAPI) window.nexusAPI.abrirVentanaPrincipal('inicio.html');
            });
        }
        if (cashierLoginForm) {
            cashierLoginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                showMessage('Cajera simulado exitoso', 'success');
                if (window.nexusAPI) window.nexusAPI.abrirVentanaPrincipal('inicio_cajera.html');
            });
        }
        if (registerCompanyForm) {
            registerCompanyForm.addEventListener('submit', (e) => {
                e.preventDefault();
                showMessage('Registro simulado exitoso', 'success');
            });
        }
        if (forgotPasswordForm) {
            forgotPasswordForm.addEventListener('submit', (e) => {
                e.preventDefault();
                showMessage('Recuperación simulada', 'success');
                closeModal();
            });
        }
    });

    document.getElementById('btn-minimize-custom')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.nexusAPI) window.nexusAPI.minimize();
    });
    document.getElementById('btn-close-custom')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.nexusAPI) window.nexusAPI.close();
    });
</script>
</body>
</html>`);

fs.writeFileSync(path, newLines.join('\\n'));
console.log('Firebase logic removed successfully.');
