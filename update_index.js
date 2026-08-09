const fs = require('fs');
let html = fs.readFileSync('c:\\NEXUS-MAYORISTA\\index.html', 'utf8');

const newLoginLogic = `if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = loginForm['login-email'].value.trim();
                const password = loginForm['login-password'].value.trim();
                
                const btn = document.getElementById('login-btn');
                const btnText = document.getElementById('login-btn-text');
                const btnSpinner = document.getElementById('login-btn-spinner');
                
                if(btn) btn.disabled = true;
                if(btnText) btnText.classList.add('hidden');
                if(btnSpinner) btnSpinner.classList.remove('hidden');

                const result = await loginConSuperTokens(email, password, 'admin');
                
                if(btn) btn.disabled = false;
                if(btnText) btnText.classList.remove('hidden');
                if(btnSpinner) btnSpinner.classList.add('hidden');

                if (result.success) {
                    showMessage('Inicio de sesión exitoso', 'success');
                    // Extraer idEmpresa real o usar mock
                    const idEmpresa = result.data?.idEmpresa || 'EMP-TEST-123';
                    
                    if (window.nexusAPI && window.nexusAPI.ejecutarMigracion) {
                        try {
                            const migracion = await window.nexusAPI.ejecutarMigracion(idEmpresa);
                            if (!migracion.success) {
                                showMessage('Error de datos: ' + migracion.message, 'error');
                                return;
                            }
                        } catch(err) {
                            console.error(err);
                        }
                    }
                    if (window.nexusAPI) window.nexusAPI.abrirVentanaPrincipal('inicio.html');
                } else {
                    showMessage(result.message, 'error');
                }
            });
        }`;

html = html.replace(/if \(loginForm\) \{\s*loginForm\.addEventListener\('submit', \(e\) => \{\s*e\.preventDefault\(\);\s*showMessage\('Login simulado exitoso', 'success'\);\s*if \(window\.nexusAPI\) window\.nexusAPI\.abrirVentanaPrincipal\('inicio\.html'\);\s*\}\);\s*\}/, newLoginLogic);

fs.writeFileSync('c:\\NEXUS-MAYORISTA\\index.html', html);
console.log('Login form updated in index.html');
