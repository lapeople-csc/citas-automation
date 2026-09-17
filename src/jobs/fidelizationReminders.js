const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const moment = require('moment-timezone');
const domusApi = require('../api/domus');
const wiseApi = require('../api/wise');
const { getBrandName, getCityFromBranchName } = require('../utils/brands');
const { capitalizeWords } = require('../utils/formatting');

const INMOBILIARIAS = ['bienco', 'uribienes', 'las_vegas'];
const TIMEZONE = 'America/Bogota';

function getReminderSearchWindow(now = moment().tz(TIMEZONE)) {
    const currentHour = now.hour();

    if (currentHour < 14) {
        return {
            date: now.format('YYYY-MM-DD'),
            startTime: '14:00:00',
            endTime: '23:59:59',
            textDay: 'Hoy'
        };
    }

    return {
        date: now.clone().add(1, 'day').format('YYYY-MM-DD'),
        startTime: '00:00:00',
        endTime: '13:30:00',
        textDay: 'Mañana'
    };
}

function getAppointmentTypeIds(inmobiliaria) {
    const value = process.env[`APPOINTMENT_TYPE_IDS_FIDELIZATION_${inmobiliaria.toUpperCase()}`];
    if (!value) {
        console.warn(`No se encontraron IDs de tipos para recordatorio de fidelizacion en ${inmobiliaria}.`);
        return [];
    }

    return value.split(',')
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => Number.isInteger(id));
}

function getReminderConfig(inmobiliaria) {
    const suffix = inmobiliaria.toUpperCase();
    return {
        templateId: Number.parseInt(process.env[`WISE_TEMPLATE_ID_FIDELIZATION`], 10),
        groupId: Number.parseInt(process.env[`WISE_GROUP_ID_FIDELIZATION`], 10),
        userId: Number.parseInt(process.env[`WISE_USER_ID_FIDELIZATION`], 10)
    };
}

async function sendDailyReminders() {
    console.log('Iniciando tarea recordatorio de fidelizacion de recordatorio de citas');
    const searchWindow = getReminderSearchWindow();

    for (const inmobiliaria of INMOBILIARIAS) {
        console.log(`\n--- Reminder Wise: ${inmobiliaria.toUpperCase()} ---`);
        const config = getReminderConfig(inmobiliaria);
        const appointmentTypeIds = getAppointmentTypeIds(inmobiliaria);

        if (![config.templateId, config.groupId, config.userId].every(Number.isInteger)) {
            console.error(`Configuración recordatorio de fidelizacion incompleta para ${inmobiliaria}.`);
            continue;
        }

        if (appointmentTypeIds.length === 0) {
            console.error(`No hay tipos de cita exclusivos configurados para recordatorio de fidelizacion en ${inmobiliaria}.`);
            continue;
        }

        try {
            const meetings = await domusApi.getMeetingsForDay(
                inmobiliaria,
                searchWindow.date,
                appointmentTypeIds
            );

            const filteredMeetings = meetings.filter((meeting) => (
                meeting.init_time &&
                meeting.init_time >= searchWindow.startTime &&
                meeting.init_time <= searchWindow.endTime
            ));

            console.log(`Citas recordatorio de fidelizacion seleccionadas: ${filteredMeetings.length}.`);

            for (const meeting of filteredMeetings) {
                try {
                    const response = await domusApi.getMeetingDetail(inmobiliaria, meeting.id);
                    const detail = response?.data ?? response;

                    if (!detail) {
                        console.warn(`No se pudo obtener detalle de la cita ${meeting.id}.`);
                        continue;
                    }

                    await sendReminderCase(
                        detail,
                        config.groupId,
                        config.templateId,
                        inmobiliaria,
                        config.userId,
                        searchWindow.textDay
                    );
                } catch (error) {
                    console.error(`Error procesando cita ${meeting.id}: ${error.message}`);
                }
            }
        } catch (error) {
            console.error(`Error obteniendo citas recordatorio de fidelizacion para ${inmobiliaria}: ${error.message}`);
        }
    }

    console.log('Tarea recordatorio de fidelizacion finalizada');
}

async function sendReminderCase(detail, groupId, templateId, inmobiliaria, userId, textDay) {
    const client = detail.contact || {};
    const phone = client.phone || client.phones?.[0]?.phone;

    if (!phone) {
        console.warn(`Omitido: cita ${detail.id} sin teléfono.`);
        return;
    }

    const phoneFormatted = wiseApi.formatPhoneNumber(phone);
    const wiseContact = await wiseApi.getContactByPhone(phoneFormatted);
    const contactId = wiseContact?.id ?? null;
    const personalId = wiseContact?.personalId ?? null;
    const name = capitalizeWords(client.full_name || `${client.name || ''} ${client.last_name || ''}`.trim()) || 'Cliente';
    const time = moment(detail.init_time, 'HH:mm:ss').format('hh:mm A');
    const address = detail.address || 'el inmueble';
    const brand = getBrandName(inmobiliaria);
    const city = (detail.detailProperties?.[0]?.city) || (brand.toLowerCase() === 'bienco' ? getCityFromBranchName(detail.branch?.name) || 'Bienco' : 'Antioquia');
    const campaign = detail.detailProperties?.[0]?.biz ?? detail.detailProperties?.[0]?.biz_code ?? '';
    const advisor = getAdvisorName(detail);
    const code = detail.code ? String(detail.code) : '';
    const webCode = detail.detailProperties?.[0]?.codpro ? String(detail.detailProperties[0].codpro) : '';
    const subject = `Recordatorio de Cita ${code} | #${webCode}`;

    const payload = {
        group_id: groupId,
        user_id: userId,
        source_channel: 'outgoing_whatsapp',
        subject,
        tags: ['Creado por API', 'Domus - Recordatorios Cita'],
        custom_fields: [
            { field: 'email_1', value: detail.date ?? '' },
            { field: 'email_2', value: String(detail.id) },
            { field: 'email_3', value: address },
            { field: 'email_4', value: time },
            { field: 'marca_spa', value: brand },
            { field: 'gestion_spa', value: campaign },
            { field: 'nombre_asesor', value: advisor },
            { field: 'codigo_de_cita', value: code },
            { field: 'codigo_web', value: webCode }
        ],
        type_id: 0,
        activities: [{
            type: 'user_reply',
            user_id: 0,
            channel: 'outgoing_whatsapp',
            template: {
                template_id: templateId,
                parameters: [
                    { key: '1', value: name },
                    { key: '2', value: textDay },
                    { key: '3', value: address },
                    { key: '4', value: time },
                ]
            },
            contacts_to: contactId
                ? [{ id: contactId }]
                : [{ name, phone: phoneFormatted }]
        }]
    };

    try {
        const response = await wiseApi.createCaseAndSend(payload, null);
        const caseId = response?.case_id;

        if (caseId) {
            console.log(`Recordatorio recordatorio de fidelizacion enviado para cita ${detail.id}.`);
            await wiseApi.updateCaseStatus(caseId, 'solved');
            return;
        }

        if (response?.error === 'OPEN_CASES_EXIST' && response.opened_cases?.length) {
            const openCaseId = response.opened_cases[0];
            await wiseApi.updateCaseStatus(openCaseId, 'closed');
            const retryResponse = await wiseApi.createCaseAndSend(payload, null);
            const retryCaseId = retryResponse?.case_id;

            if (retryCaseId) {
                console.log(`Recordatorio recordatorio de fidelizacion reenviado para cita ${detail.id}.`);
                await wiseApi.updateCaseStatus(retryCaseId, 'solved');
            }
            return;
        }

        console.error(`Fallo envío recordatorio de fidelizacion para cita ${detail.id}:`, response);
    } catch (error) {
        console.error(`Error creando caso recordatorio de fidelizacion para cita ${detail.id}: ${error.message}`);
    }
}

function getClientName(client) {
    const fullName = capitalizeWords(client.full_name || '').trim();
    if (fullName) return fullName;

    return capitalizeWords(`${client.name || ''} ${client.last_name || ''}`.trim()) || 'Cliente';
}

function getAdvisorName(detail) {
    if (!Array.isArray(detail.profiles)) return '';

    const host = detail.profiles.find((profile) => (
        profile.role?.name === 'Anfitrión' || profile.role?.id === 1
    ));
    const profile = host?.profile || detail.profiles[0]?.profile;
    if (!profile) return '';

    return profile.full_name || `${profile.name || ''} ${profile.last_name || ''}`.trim();
}

if (require.main === module) {
    sendDailyReminders().catch((error) => {
        console.error(`Error en recordatorio de fidelizacion: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    getReminderSearchWindow,
    sendDailyReminders,
    sendReminderCase
};