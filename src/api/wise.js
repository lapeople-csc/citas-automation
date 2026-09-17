const axios = require('axios');
require('dotenv').config({ path: '../../.env' });

//urls endpoints wise cx
const WISE_API_URL = process.env.WISE_API_URL || "https://api.wcx.cloud/core/v1";

/**
 * Formatea un número de teléfono agregando el indicativo 57.
 * @param {string} phoneNumber
 * @returns {string}
 */
function formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) {
        return '';
    }
    let cleanedNumber = phoneNumber.replace(/[^\d]/g, '');

    if (cleanedNumber.length === 10 && cleanedNumber.startsWith('3')) {
        return `57${cleanedNumber}`;
    }
    return cleanedNumber;
}

/** 
 * @returns {Promise<string|null>}
*/
async function authenticateAndGetToken() {
    const wiseApiKeyAuth = process.env.WISE_AUTH_TOKEN;
    const wiseUser = process.env.WISE_USER;

    if (!wiseApiKeyAuth || !wiseUser) {
        console.error("Error de autenticacion WISE")
        return null;

    }

    try {
        const headers = {
            'x-api-key': wiseApiKeyAuth,
            'Content-Type': 'application/json'
        };

        const url = `${WISE_API_URL}/authenticate?user=${wiseUser}`;

        const response = await axios.get(url, { headers });
        console.log("Autenticacion existosa");
        return response.data.token;

    } catch (error) {
        console.error(`Error al autenticar en WISE: ${error.message}`);
        if (error.response) {
            console.error("Detalle del error:", error.response.data);
        }
        return null;
    }

}

/**
 * @param {object} payload
 * @param {string} contactId
 * @returns {Promise<object|null>}
 */
async function createCaseAndSend(payload, contactId) {
    const token = await authenticateAndGetToken();
    if (!token) return null;

    const headers = {
        'x-api-key': process.env.WISE_AUTH_TOKEN,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const url = `${WISE_API_URL}/cases`;

    const newPayload = { ...payload };
    if (contactId) {
        newPayload.activities[0].contacts_to = [{ id: contactId }];
    } else {
        newPayload.activities[0].contacts_to = payload.activities[0].contacts_to;
    }

    try {
        const response = await axios.post(url, newPayload, { headers });
        console.log(`Exito. Wise CX Caso creado`);
        return response.data;

    } catch (error) {
        console.error(`Error al crear el caso: ${error.message}`);
        if (error.response) {
            console.error("Detalle del error:", error.response.data);
            return error.response.data;

        }
        return { error: error.message, opened_cases: [] };

    }


}

/**
 * @param {string} phoneNumber
 * @returns {Promise<string|null>}
 */
async function getContactIdByPhone(phoneNumber) {
    const token = await authenticateAndGetToken();
    if (!token) return null;

    const headers = {
        'x-api-key': process.env.WISE_AUTH_TOKEN,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const filters = JSON.stringify([
        {
            "field": "contact.phone",
            "operator": "EQUAL",
            "value": phoneNumber
        }
    ]);

    try {
        const response = await axios.get(`${WISE_API_URL}/contacts`, {
            headers,
            params: {
                'filtering': filters,
                'fields': 'id,email,personal_id,phone,name'
            }
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
            return response.data.data[0].id;
        }
        return null;
    } catch (error) {
        console.error(`Error al obtener el ID de contacto por teléfono (${phoneNumber}):`, error.response ? error.response.data : error.message);
        return null;
    }
}

async function getContactByPhone(phoneNumber) {
    const contactId = await getContactIdByPhone(phoneNumber);
    return contactId ? { id: contactId } : null;
}

/**
 * @param {string} email
 * @returns {Promise<string|null>}
 */
async function getContactIdByEmail(email) {
    const token = await authenticateAndGetToken();
    if (!token) return null;

    const headers = {
        'x-api-key': process.env.WISE_AUTH_TOKEN,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const filters = JSON.stringify([
        {
            "field": "contact.email",
            "operator": "EQUAL",
            "value": email
        }
    ]);

    try {
        const response = await axios.get(`${WISE_API_URL}/contacts`, {
            headers,
            params: {
                'filtering': filters,
                'fields': 'id,email,personal_id,phone,name'
            }
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
            return response.data.data[0].id;
        }
        return null;
    } catch (error) {
        console.error(`Error al obtener el ID de contacto por email (${email}):`, error.response ? error.response.data : error.message);
        return null;
    }
}

/**
 * @param {string} contactId
 * @returns {Promise<string|null>}
 */
async function getOpenCaseIdByContactId(contactId) {
    const token = await authenticateAndGetToken();
    if (!token) return null;

    const headers = {
        'x-api-key': process.env.WISE_AUTH_TOKEN,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const startDate = moment().subtract(30, 'days').format('YYYY-MM-DD HH:mm:ss');
    const endDate = moment().format('YYYY-MM-DD HH:mm:ss');

    const dateFilters = JSON.stringify([
        { "field": "case.created_at", "operator": "GREATER EQUAL", "value": startDate },
        { "field": "case.created_at", "operator": "LOWER", "value": endDate }
    ]);

    // Filtro de contacto, estado y canal
    const contactFilters = JSON.stringify([
        { "field": "case.contact_id", "operator": "EQUAL", "value": contactId },
        { "field": "case.status", "operator": "IN", "value": ["open"] },
        { "field": "case.source_channel", "operator": "EQUAL", "value": "new_email" }
    ]);

    try {
        const response = await axios.get(`${WISE_API_URL}/cases`, {
            headers,
            params: {
                'filtering': dateFilters,
                'filtering': contactFilters,
                'fields': 'id,user_id,contact_id,status'
            }
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
            const foundCase = response.data.data.find(c => String(c.contact_id) === String(contactId) && c.status === 'open');
            if (foundCase) {
                return foundCase.id;
            }
        }
        return null;
    } catch (error) {
        console.error(`Error al obtener el ID del caso abierto para el contacto (${contactId}):`, error.response ? error.response.data : error.message);
        return null;
    }
}

/**
 * @param {string} caseId
 * @param {string} status
 * @returns {Promise<object|null>}
 */
async function updateCaseStatus(caseId, status) {

    if (!caseId || !status) {
        throw new Error("Se requiere de un id de caso y un estado para actualizar.");
    }

    try {
        const token = await authenticateAndGetToken();
        const headers = {
            'x-api-key': process.env.WISE_AUTH_TOKEN,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        const body = { status };
        const url = `${process.env.WISE_API_URL}/cases/${caseId}`;

        const response = await axios.put(url, body, { headers });
        console.log(`✅ Caso ${caseId} actualizado a estado '${status}'.`);
        return response.data;
    } catch (error) {
        console.error(`❌ Fallo al actualizar caso ${caseId}:`, error.message);
        throw error;
    }
}

module.exports = {
    formatPhoneNumber,
    authenticateAndGetToken,
    createCaseAndSend,
    getContactIdByPhone,
    getContactByPhone,
    getContactIdByEmail,
    getOpenCaseIdByContactId,
    updateCaseStatus
};