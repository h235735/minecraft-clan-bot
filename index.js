const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { Pool } = require('pg');
const http = require('http');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// --- ПОДКЛЮЧЕНИЕ К POSTGRESQL (SUPABASE) ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS clans (
                user_id VARCHAR(255) PRIMARY KEY,
                clan_name VARCHAR(255),
                category_id VARCHAR(255),
                base_role_id VARCHAR(255),
                officer_role_id VARCHAR(255),
                leader_role_id VARCHAR(255)
            );
        `);
        console.log('✅ Таблица clans готова (PostgreSQL)');
    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err);
    }
}

async function getClan(userId) {
    const res = await pool.query('SELECT * FROM clans WHERE user_id = $1', [userId]);
    return res.rows[0];
}

async function saveClan(userId, data) {
    await pool.query(
        `INSERT INTO clans (user_id, clan_name, category_id, base_role_id, officer_role_id, leader_role_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
         clan_name = EXCLUDED.clan_name,
         category_id = EXCLUDED.category_id,
         base_role_id = EXCLUDED.base_role_id,
         officer_role_id = EXCLUDED.officer_role_id,
         leader_role_id = EXCLUDED.leader_role_id`,
        [userId, data.clanName, data.categoryId, data.baseRoleId, data.officerRoleId, data.leaderRoleId]
    );
}

async function deleteClan(userId) {
    await pool.query('DELETE FROM clans WHERE user_id = $1', [userId]);
}

async function getAllClans() {
    const res = await pool.query('SELECT * FROM clans');
    return res.rows;
}
// --- КОНЕЦ БЛОКА БД ---

const commands = [
    new SlashCommandBuilder()
        .setName('создатьклан')
        .setDescription('Создать личную категорию и роли вашего клана (Доступно 1 раз)')
        .addStringOption(opt => opt.setName('название').setDescription('Название вашего клана').setRequired(true)),

    new SlashCommandBuilder()
        .setName('переименоватьклан')
        .setDescription('Изменить название вашего клана, ролей и категории')
        .addStringOption(opt => opt.setName('новое_название').setDescription('Новое название вашего клана').setRequired(true)),

    new SlashCommandBuilder()
        .setName('удалитьклан')
        .setDescription('Полностью удалить ваш клан (категорию и роли)'),

    new SlashCommandBuilder()
        .setName('клан')
        .setDescription('Управление участниками вашего клана')
        .addUserOption(opt => opt.setName('игрок').setDescription('Кого настраиваем?').setRequired(true))
        .addStringOption(opt => opt.setName('ранг')
            .setDescription('Что сделать?')
            .setRequired(true)
            .addChoices(
                { name: 'Выдать Бойца', value: 'member' },
                { name: 'Выдать Офицера', value: 'officer' },
                { name: 'Замутить (1 час)', value: 'mute' },
                { name: 'Размутить', value: 'unmute' },
                { name: 'Исключить', value: 'kick' }
            ))
].map(c => c.toJSON());

client.once('ready', async () => {
    console.log(`Бот запущен: ${client.user.tag}`);
    await initDB();

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN.trim());
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Слэш-команды обновлены!');
    } catch (e) { console.error('❌ Ошибка регистрации команд:', e); }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guild, member, user } = interaction;

    // --- СОЗДАТЬ КЛАН ---
    if (commandName === 'создатьклан') {
        await interaction.deferReply({ ephemeral: true });
        const existing = await getClan(user.id);
        if (existing) return interaction.editReply('❌ Вы уже создали клан! Сначала `/удалитьклан`.');

        const clanName = interaction.options.getString('название');
        try {
            const leaderPerms = [
                PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ModerateMembers
            ];
            const baseRole = await guild.roles.create({ name: clanName });
            const officerRole = await guild.roles.create({ name: `Офицер: ${clanName}`, color: '#e67e22' });
            const leaderRole = await guild.roles.create({ name: `Лидер: ${clanName}`, color: '#d35400', permissions: leaderPerms });

            const botHighest = guild.members.me.roles.highest.position;
            try {
                await guild.roles.setPositions([
                    { role: leaderRole, position: botHighest - 1 },
                    { role: officerRole, position: botHighest - 2 },
                    { role: baseRole, position: botHighest - 3 }
                ]);
            } catch (e) { console.warn('Позиции ролей:', e.message); }

            await member.roles.add(leaderRole);
            await member.roles.add(baseRole);

            const category = await guild.channels.create({
                name: `⛺ КЛАН: ${clanName.toUpperCase()}`,
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: baseRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: officerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers] },
                    { id: leaderRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ModerateMembers] }
                ]
            });
            await guild.channels.create({ name: 'клановый-чат', type: ChannelType.GuildText, parent: category.id });

            await saveClan(user.id, {
                clanName, categoryId: category.id,
                baseRoleId: baseRole.id, officerRoleId: officerRole.id, leaderRoleId: leaderRole.id
            });

            return interaction.editReply(`✅ Клан **${clanName}** создан! Вы — Лидер.`);
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Ошибка. Проверьте, что роль бота ВЫШЕ всех ролей.');
        }
    }

    // --- ПЕРЕИМЕНОВАТЬ ---
    if (commandName === 'переименоватьклан') {
        await interaction.deferReply({ ephemeral: true });
        const myClan = await getClan(user.id);
        if (!myClan) return interaction.editReply('❌ У вас нет клана.');
        const newName = interaction.options.getString('новое_название');
        try {
            const category = guild.channels.cache.get(myClan.category_id);
            if (category) await category.setName(`⛺ КЛАН: ${newName.toUpperCase()}`);
            const br = guild.roles.cache.get(myClan.base_role_id); if (br) await br.setName(newName);
            const or = guild.roles.cache.get(myClan.officer_role_id); if (or) await or.setName(`Офицер: ${newName}`);
            const lr = guild.roles.cache.get(myClan.leader_role_id); if (lr) await lr.setName(`Лидер: ${newName}`);

            await pool.query('UPDATE clans SET clan_name = $1 WHERE user_id = $2', [newName, user.id]);
            return interaction.editReply(`📝 Клан переименован в **${newName}**!`);
        } catch (err) { console.error(err); return interaction.editReply('❌ Ошибка переименования.'); }
    }

    // --- УДАЛИТЬ ---
    if (commandName === 'удалитьклан') {
        await interaction.deferReply({ ephemeral: true });
        const myClan = await getClan(user.id);
        if (!myClan) return interaction.editReply('❌ У вас нет клана.');
        try {
            const category = guild.channels.cache.get(myClan.category_id);
            if (category) {
                const children = guild.channels.cache.filter(c => c.parentId === category.id);
                for (const [, child] of children) await child.delete().catch(() => null);
                await category.delete().catch(() => null);
            }
            for (const id of [myClan.base_role_id, myClan.officer_role_id, myClan.leader_role_id]) {
                const role = guild.roles.cache.get(id);
                if (role) await role.delete().catch(() => null);
            }
            await deleteClan(user.id);
            return interaction.editReply('🗑️ Клан полностью удалён.');
        } catch (err) { console.error(err); return interaction.editReply('❌ Ошибка удаления.'); }
    }

    // --- УПРАВЛЕНИЕ УЧАСТНИКАМИ ---
    if (commandName === 'клан') {
        const target = interaction.options.getMember('игрок');
        const rank = interaction.options.getString('ранг');

        let myClan = null;
        const allClans = await getAllClans();
        for (const c of allClans) {
            if (member.roles.cache.has(c.leader_role_id) || member.roles.cache.has(c.officer_role_id)) {
                myClan = c; break;
            }
        }
        if (!myClan) return interaction.reply({ content: '❌ Вы не Лидер и не Офицер.', ephemeral: true });

        const isLeader = member.roles.cache.has(myClan.leader_role_id);
        const br = guild.roles.cache.get(myClan.base_role_id);
        const or = guild.roles.cache.get(myClan.officer_role_id);
        const lr = guild.roles.cache.get(myClan.leader_role_id);

        if (!br) return interaction.reply({ content: '❌ Роль клана удалена.', ephemeral: true });

        await interaction.deferReply();
        try {
            if (rank === 'member') {
                await target.roles.add(br);
                return interaction.editReply(`✅ ${target} — Боец клана **${myClan.clan_name}**.`);
            }
            if (rank === 'officer') {
                if (!isLeader) return interaction.editReply('❌ Только Лидер может назначать Офицеров!');
                await target.roles.add(br); await target.roles.add(or);
                return interaction.editReply(`👑 ${target} — Офицер клана **${myClan.clan_name}**.`);
            }
            if (rank === 'mute') {
                if (target.roles.cache.has(lr.id)) return interaction.editReply('❌ Нельзя замутить Лидера.');
                await target.timeout(60 * 60 * 1000, `Мут от ${user.tag}`);
                return interaction.editReply(`🔇 ${target} замучен на 1 час.`);
            }
            if (rank === 'unmute') {
                await target.timeout(null, `Размут от ${user.tag}`);
                return interaction.editReply(`🔊 С ${target} снят мут.`);
            }
            if (rank === 'kick') {
                if (target.roles.cache.has(lr.id)) return interaction.editReply('❌ Нельзя исключить Лидера.');
                await target.roles.remove(br); if (or) await target.roles.remove(or);
                return interaction.editReply(`🚪 ${target} исключён из клана **${myClan.clan_name}**.`);
            }
        } catch (err) { console.error(err); return interaction.editReply('❌ Ошибка. Роль бота должна быть ВЫШЕ.'); }
    }
});

// --- ЛОГИРОВАНИЕ ОШИБОК КЛИЕНТА ---
client.on('error', err => console.error('❌ Client error:', err));

// --- HTTP-ЗАГЛУШКА для Render ---
const port = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
}).listen(port, () => {
    console.log(`HTTP-заглушка слушает порт ${port}`);
});

// --- ДИАГНОСТИКА И ЛОГИН В DISCORD ---
const rawToken = process.env.TOKEN || '';
const cleanToken = rawToken.trim();
console.log('🔍 TOKEN длина:', rawToken.length, '→ после trim:', cleanToken.length);
console.log('🔍 TOKEN начинается с', cleanToken.substring(0, 10) + '...');
console.log('🔍 TOKEN заканчивается на', cleanToken.substring(cleanToken.length - 5));
console.log('🔍 TOKEN содержит пробелы/переносы?', rawToken !== cleanToken ? 'ДА' : 'НЕТ');
console.log('🔍 DATABASE_URL начинается с', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + '...' : 'НЕТ URL');
console.log('🔍 Попытка входа в Discord...');

// --- REST-ТЕСТ ТОКЕНА (без WebSocket) ---
const testRest = new REST({ version: '10' }).setToken(cleanToken);
testRest.get(Routes.user('@me'))
    .then(user => console.log('✅ Токен валиден. Бот:', user.username, '| ID:', user.id))
    .catch(err => console.error('❌ Токен НЕ валиден:', err.message));

// --- ЛОГИН С ТАЙМАУТОМ ---
const loginTimeout = setTimeout(() => {
    console.error('❌ ТАЙМАУТ: client.login() не ответил за 30 секунд');
}, 30000);

client.login(cleanToken)
    .then(() => {
        clearTimeout(loginTimeout);
        console.log('🔍 client.login() завершился успешно');
    })
    .catch(err => {
        clearTimeout(loginTimeout);
        console.error('❌ Ошибка входа в Discord:', err.message);
        console.error('❌ Код ошибки:', err.code);
    });
