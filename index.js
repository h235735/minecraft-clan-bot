const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const DATA_FILE = './clans.json';

function loadClanData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function saveClanData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

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
        .setDescription('Полностью удалить ваш клан (категорию и роли), чтобы создать новый'),

    new SlashCommandBuilder()
        .setName('клан')
        .setDescription('Управление участниками вашего клана (Для Лидеров и Офицеров)')
        .addUserOption(opt => opt.setName('игрок').setDescription('Кого настраиваем?').setRequired(true))
        .addStringOption(opt => opt.setName('ранг')
            .setDescription('Что сделать?')
            .setRequired(true)
            .addChoices(
                { name: 'Выдать Бойца', value: 'member' },
                { name: 'Выдать Офицера', value: 'officer' },
                { name: 'Замутить (тайм-аут 1 час)', value: 'mute' },
                { name: 'Размутить', value: 'unmute' },
                { name: 'Исключить из клана', value: 'kick' }
            ))
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Бот запущен под именем ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Слэш-команды успешно обновлены!');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guild, member, user } = interaction;
    let clanData = loadClanData();

    // --- 1. СОЗДАТЬ КЛАН ---
    if (commandName === 'создатьклан') {
        await interaction.deferReply({ ephemeral: true });

        if (clanData[user.id]) {
            return interaction.editReply('❌ Вы уже создали клан! Сначала удалите старый `/удалитьклан` или измените имя `/переименоватьклан`.');
        }

        const clanName = interaction.options.getString('название');

        try {
            const leaderPerms = [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ManageRoles,
                PermissionFlagsBits.ModerateMembers
            ];

            const baseRole = await guild.roles.create({
                name: clanName,
                reason: `Создал ${user.tag}`
            });

            const officerRole = await guild.roles.create({
                name: `Офицер: ${clanName}`,
                color: '#e67e22',
                reason: `Создал ${user.tag}`
            });

            const leaderRole = await guild.roles.create({
                name: `Лидер: ${clanName}`,
                color: '#d35400',
                permissions: leaderPerms,
                reason: `Создал ${user.tag}`
            });

            // Иерархия: Лидер > Офицер > Боец, все под ролью бота
            const botHighest = guild.members.me.roles.highest.position;
            try {
                await guild.roles.setPositions([
                    { role: leaderRole,  position: botHighest - 1 },
                    { role: officerRole, position: botHighest - 2 },
                    { role: baseRole,    position: botHighest - 3 }
                ]);
            } catch (e) {
                console.warn('Не удалось выставить позиции ролей:', e.message);
            }

            await member.roles.add(leaderRole);
            await member.roles.add(baseRole);

            const category = await guild.channels.create({
                name: `⛺ КЛАН: ${clanName.toUpperCase()}`,
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: baseRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    {
                        id: officerRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.ModerateMembers
                        ]
                    },
                    {
                        id: leaderRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.ManageRoles,
                            PermissionFlagsBits.ModerateMembers
                        ]
                    }
                ]
            });

            await guild.channels.create({
                name: 'клановый-чат',
                type: ChannelType.GuildText,
                parent: category.id
            });

            clanData[user.id] = {
                clanName: clanName,
                categoryId: category.id,
                baseRoleId: baseRole.id,
                officerRoleId: officerRole.id,
                leaderRoleId: leaderRole.id
            };
            saveClanData(clanData);

            return interaction.editReply(
                `✅ Ваш клан **${clanName}** создан! Вы — Лидер.\n` +
                `Теперь вы можете менять права ролей «${clanName}» и «Офицер: ${clanName}» в настройках сервера и мутить участников.`
            );
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Ошибка создания клана. Проверьте, что роль бота стоит ВЫШЕ всех остальных ролей.');
        }
    }

    // --- 2. ПЕРЕИМЕНОВАТЬ КЛАН ---
    if (commandName === 'переименоватьклан') {
        await interaction.deferReply({ ephemeral: true });

        if (!clanData[user.id]) {
            return interaction.editReply('❌ У вас нет созданного клана.');
        }

        const myClan = clanData[user.id];
        const newClanName = interaction.options.getString('новое_название');

        try {
            const category = guild.channels.cache.get(myClan.categoryId);
            if (category) await category.setName(`⛺ КЛАН: ${newClanName.toUpperCase()}`);

            const baseRole = guild.roles.cache.get(myClan.baseRoleId);
            if (baseRole) await baseRole.setName(newClanName);

            const officerRole = guild.roles.cache.get(myClan.officerRoleId);
            if (officerRole) await officerRole.setName(`Офицер: ${newClanName}`);

            const leaderRole = guild.roles.cache.get(myClan.leaderRoleId);
            if (leaderRole) await leaderRole.setName(`Лидер: ${newClanName}`);

            clanData[user.id].clanName = newClanName;
            saveClanData(clanData);

            return interaction.editReply(`📝 Ваш клан переименован в **${newClanName}**!`);
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Не удалось переименовать клан.');
        }
    }

    // --- 3. УДАЛИТЬ КЛАН ---
    if (commandName === 'удалитьклан') {
        await interaction.deferReply({ ephemeral: true });

        if (!clanData[user.id]) {
            return interaction.editReply('❌ У вас нет созданного клана.');
        }

        const myClan = clanData[user.id];

        try {
            const category = guild.channels.cache.get(myClan.categoryId);
            if (category) {
                const children = guild.channels.cache.filter(c => c.parentId === category.id);
                for (const [, child] of children) {
                    await child.delete().catch(() => null);
                }
                await category.delete().catch(() => null);
            }

            const roleIds = [myClan.baseRoleId, myClan.officerRoleId, myClan.leaderRoleId];
            for (const id of roleIds) {
                const role = guild.roles.cache.get(id);
                if (role) await role.delete().catch(() => null);
            }

            delete clanData[user.id];
            saveClanData(clanData);

            return interaction.editReply('🗑️ Клан полностью удалён.');
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Ошибка при удалении клана.');
        }
    }

    // --- 4. УПРАВЛЕНИЕ УЧАСТНИКАМИ (поиск по ID, а не по имени) ---
    if (commandName === 'клан') {
        const targetMember = interaction.options.getMember('игрок');
        const rank = interaction.options.getString('ранг');

        // Ищем, к какому клану относится автор команды — по ID его ролей
        let ownerId = null;
        for (const [id, data] of Object.entries(clanData)) {
            if (
                member.roles.cache.has(data.leaderRoleId) ||
                member.roles.cache.has(data.officerRoleId)
            ) {
                ownerId = id;
                break;
            }
        }

        if (!ownerId) {
            return interaction.reply({ content: '❌ Вы не Лидер и не Офицер какого-либо клана.', ephemeral: true });
        }

        const myClan = clanData[ownerId];
        const isLeader = member.roles.cache.has(myClan.leaderRoleId);

        const clanBaseRole = guild.roles.cache.get(myClan.baseRoleId);
        const clanOfficerRole = guild.roles.cache.get(myClan.officerRoleId);
        const clanLeaderRole = guild.roles.cache.get(myClan.leaderRoleId);

        if (!clanBaseRole) {
            return interaction.reply({ content: '❌ Основная роль клана была удалена. Обратитесь к администрации.', ephemeral: true });
        }

        const activeClanName = myClan.clanName || clanBaseRole.name;

        await interaction.deferReply();

        try {
            if (rank === 'member') {
                await targetMember.roles.add(clanBaseRole);
                return interaction.editReply(`✅ ${targetMember} принят в клан **${activeClanName}** как Боец.`);
            }

            if (rank === 'officer') {
                if (!isLeader) return interaction.editReply('❌ Только Лидер может назначать Офицеров!');
                await targetMember.roles.add(clanBaseRole);
                await targetMember.roles.add(clanOfficerRole);
                return interaction.editReply(`👑 ${targetMember} повышен до Офицера клана **${activeClanName}**.`);
            }

            if (rank === 'mute') {
                if (targetMember.roles.cache.has(clanLeaderRole.id)) {
                    return interaction.editReply('❌ Нельзя замутить Лидера клана.');
                }
                await targetMember.timeout(60 * 60 * 1000, `Мут от ${user.tag}`);
                return interaction.editReply(`🔇 ${targetMember} замучен на 1 час.`);
            }

            if (rank === 'unmute') {
                await targetMember.timeout(null, `Снятие мута от ${user.tag}`);
                return interaction.editReply(`🔊 С ${targetMember} снят мут.`);
            }

            if (rank === 'kick') {
                if (targetMember.roles.cache.has(clanLeaderRole.id)) {
                    return interaction.editReply('❌ Нельзя исключить Лидера клана.');
                }
                await targetMember.roles.remove(clanBaseRole);
                if (clanOfficerRole) await targetMember.roles.remove(clanOfficerRole);
                return interaction.editReply(`🚪 ${targetMember} исключён из клана **${activeClanName}**.`);
            }
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Не удалось выполнить действие. Проверьте, что роль бота стоит ВЫШЕ всех клановых ролей.');
        }
    }
});

// --- HTTP-ЗАГЛУШКА (нужна для Fly.io, Render и т.п.) ---
const port = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
}).listen(port, () => {
    console.log(`HTTP-заглушка слушает порт ${port}`);
});

client.login(process.env.TOKEN);
