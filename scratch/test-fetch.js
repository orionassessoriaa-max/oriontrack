const baseUrl = 'https://api.orionassessoriaa.com.br';
const apiKey = '933cb94ef4dc69b7494f4c851969c404';

async function test() {
  console.log('--- Teste 1: Buscar Instâncias ---');
  try {
    const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
      }
    });
    console.log('Status:', res.status);
    const body = await res.json().catch(() => ({}));
    console.log('Body:', JSON.stringify(body, null, 2));
  } catch (err) {
    console.error('Erro no Teste 1:', err.message);
  }

  console.log('\n--- Teste 2: Criar Instância de Teste ---');
  try {
    const testInstance = 'orion_test_' + Math.random().toString(36).substring(7);
    console.log('Criando instância:', testInstance);
    const res = await fetch(`${baseUrl}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
      },
      body: JSON.stringify({
        instanceName: testInstance,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      })
    });
    console.log('Status:', res.status);
    const body = await res.json().catch(() => ({}));
    console.log('Body:', JSON.stringify(body, null, 2));
  } catch (err) {
    console.error('Erro no Teste 2:', err.message);
  }
}

test();
