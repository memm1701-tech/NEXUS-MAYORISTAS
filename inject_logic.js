const fs = require('fs');
let html = fs.readFileSync('c:\\NEXUS-MAYORISTA\\index.html', 'utf8');

const superTokensScript = `
    // Inicialización de SuperTokens
    const API_URL = 'http://68.168.218.147:4030';
    
    // Función para manejar Login (con el SDK de SuperTokens si se importara, 
    // pero simulamos las peticiones REST nativas como pidió el documento)
    async function loginConSuperTokens(email, password, rolEsperado) {
        try {
            const response = await fetch(API_URL + '/auth/signin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ formFields: [
                    { id: 'email', value: email },
                    { id: 'password', value: password }
                ]})
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'OK') {
                    // El SDK manejaría las cookies automáticamente si CORS/Credentials están bien.
                    return { success: true, data: data };
                } else {
                    return { success: false, message: 'Credenciales inválidas' };
                }
            } else {
                return { success: false, message: 'Error de red o servidor' };
            }
        } catch(e) {
            console.error(e);
            return { success: false, message: 'Error de conexión con el servidor de Auth' };
        }
    }

    // Funciones personalizadas (Registro Empresa y Cajera)
    async function registrarEmpresa(nombre, email, password) {
        const response = await fetch(API_URL + '/auth-api/registrar-empresa-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombreEmpresa: nombre, correoAdmin: email, contrasenaAdmin: password })
        });
        return await response.json();
    }

    async function cargarTasaKiosco() {
        const tasaDisplay = document.getElementById('tasa-bcv-display');
        if (!tasaDisplay) return;

        try {
            const URL_TASA = 'http://68.168.218.147:3002/api/tasas';
            const response = await fetch(URL_TASA);
            if (!response.ok) throw new Error('El scraper respondió con error');

            const data = await response.json();
            let usdValue = null;
            if (data) {
                if (data.rates) {
                    usdValue = data.rates.USD || data.rates.Usd || data.rates.dolar || data.rates.DOLAR || data.rates['dólar'];
                }
                if (usdValue == null) {
                    usdValue = data.USD || data.dolar || data.DOLAR;
                }
            }
            if (usdValue == null) throw new Error('USD no encontrado');

            const num = parseFloat(String(usdValue).replace(',', '.'));
            if (isNaN(num)) throw new Error('Valor no numérico');

            tasaDisplay.textContent = 'Bs. ' + num.toFixed(2);
        } catch (error) {
            console.error(error);
            tasaDisplay.textContent = 'Bs. --';
        }
    }
    
    // Cargar tasa al inicio
    cargarTasaKiosco();
`;

// Insert the new logic before </script> in the HTML file
html = html.replace('</script>', superTokensScript + '\n</script>');

// Update the simulated submit handlers to use SuperTokens and real endpoints
html = html.replace(/if \(loginForm\) {[\s\S]*?}\n        }/g, `if (loginForm) {
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
                    if (window.nexusAPI) window.nexusAPI.abrirVentanaPrincipal('inicio.html');
                } else {
                    showMessage(result.message, 'error');
                }
            });
        }`);

html = html.replace(/if \(cashierLoginForm\) {[\s\S]*?}\n        }/g, `if (cashierLoginForm) {
            cashierLoginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = cashierLoginForm['cashier-email'].value.trim();
                const password = cashierLoginForm['cashier-password'].value.trim();
                
                const btn = document.getElementById('cashier-login-btn');
                if(btn) { btn.disabled = true; btn.textContent = 'Cargando...'; }

                const result = await loginConSuperTokens(email, password, 'cajera');
                
                if(btn) { btn.disabled = false; btn.textContent = 'Entrar como Asistente de Administrador'; }

                if (result.success) {
                    showMessage('Inicio de sesión exitoso', 'success');
                    if (window.nexusAPI) window.nexusAPI.abrirVentanaPrincipal('inicio_cajera.html');
                } else {
                    showMessage(result.message, 'error');
                }
            });
        }`);

html = html.replace(/if \(registerCompanyForm\) {[\s\S]*?}\n        }/g, `if (registerCompanyForm) {
            registerCompanyForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const nombre = registerCompanyForm['company-name'].value;
                const email = registerCompanyForm['company-admin-email'].value.trim();
                const password = registerCompanyForm['company-admin-password'].value.trim();
                
                const btn = document.getElementById('register-company-btn');
                if(btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

                try {
                    const result = await registrarEmpresa(nombre, email, password);
                    if (result && result.idEmpresa) {
                        showMessage('Empresa registrada con éxito', 'success');
                        toggleForms('login');
                    } else {
                        showMessage(result.mensaje || 'Error al registrar', 'error');
                    }
                } catch(err) {
                    showMessage('Error de conexión', 'error');
                } finally {
                    if(btn) { btn.disabled = false; btn.textContent = 'Registrar Empresa'; }
                }
            });
        }`);

fs.writeFileSync('c:\\NEXUS-MAYORISTA\\index.html', html);
console.log('Done replacing functions');
