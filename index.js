const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const DATA_FILE = './clans.json';

// Функция загрузки данных о созданных кланах
function loadClanData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

// Функция сохранения данных
function saveClanData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Регистрация всех слэш-команд
const commands = [
    new SlashCommandBuilder()
        .setName('создатьклан')
        .setDescription('Создать личную категорию и роли вашего клана (Доступно 1 раз)')
        .addStringOption(opt => opt.setName('название').setDescription('Название вашего клана').setRequired(true)),

    new SlashCommandBuilder()
        .setName('переименоватьклан')
        .setDescription('Изменить название вашего клана, ролей и категории (Можно использовать когда угодно)')
        .addStringOption(opt => opt.setName('новое_название').setDescription('Новое название вашего клана').setRequired(true)),

    new SlashCommandBuilder()
        .setName('удалитьклан')
        .setDescription('Полностью удалить ваш клан (категорию и роли), чтобы создать новый'),

    new SlashCommandBuilder()
        .setName('клан')
        .setDescription('Управление участниками вашего клана (Для Лидеров и Офицеров)')
        .addUserOption(opt => opt.setName('игрок').setDescription('Кого настраиваем?').setRequired(true))
        .addStringOption(opt => opt.setName('ранг')
            .setDescription('Какую роль присвоить?')
            .setRequired(true)
            .addChoices(
                { name: 'Выдать Бойца', value: 'member' },
                { name: 'Выдать Офицера', value: 'officer' },
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

    // --- 1. КОМАНДА: СОЗДАТЬ КЛАН ---
    if (commandName === 'создатьклан') {
        await interaction.deferReply({ ephemeral: true });

        if (clanData[user.id]) {
            return interaction.editReply('❌ Вы уже создали клан! Сначала удалите старый с помощью команды `/удалитьклан` или измените имя через `/переименоватьклан`.');
        }

        const clanName = interaction.options.getString('название');

        try {
            const baseRole = await guild.roles.create({ name: clanName, reason: `Создал ${user.tag}` });
            const officerRole = await guild.roles.create({ name: `Офицер: ${clanName}`, color: '#e67e22' });
            const leaderRole = await guild.roles.create({ name: `Лидер: ${clanName}`, color: '#d35400' });

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
                            PermissionFlagsBits.ManageMessages
                        ] 
                    },
                    { 
                        id: leaderRole.id, 
                        allow: [
                            PermissionFlagsBits.ViewChannel, 
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ManageMessages
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

            return interaction.editReply(`✅ Ваш клан **${clanName}** успешно создан! Вы автоматически назначены Лидером.`);
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Ошибка создания клана. Проверьте права Администратора у бота.');
        }
    }

    // --- 2. КОМАНДА: ПЕРЕИМЕНОВАТЬ КЛАН (В любое время) ---
    if (commandName === 'переименоватьклан') {
        await interaction.deferReply({ ephemeral: true });

        // Проверка владения кланом
        if (!clanData[user.id]) {
            return interaction.editReply('❌ У вас нет созданного клана, который можно переименовать.');
        }

        const myClan = clanData[user.id];
        const newClanName = interaction.options.getString('новое_название');

        try {
            // Переименовываем категорию в Discord
            const category = guild.channels.cache.get(myClan.categoryId);
            if (category) {
                await category.setName(`⛺ КЛАН: ${newClanName.toUpperCase()}`);
            }

            // Переименовываем роли в Discord
            const baseRole = guild.roles.cache.get(myClan.baseRoleId);
            if (baseRole) await baseRole.setName(newClanName);

            const officerRole = guild.roles.cache.get(myClan.officerRoleId);
            if (officerRole) await officerRole.setName(`Офицер: ${newClanName}`);

            const leaderRole = guild.roles.cache.get(myClan.leaderRoleId);
            if (leaderRole) await leaderRole.setName(`Лидер: ${newClanName}`);

            // Обновляем название в базе данных бота
            clanData[user.id].clanName = newClanName;
            saveClanData(clanData);

            return interaction.editReply(`📝 Ваш клан успешно переименован в **${newClanName}**! Категория и все связанные роли обновлены.`);
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Не удалось переименовать клан. Убедитесь, что роль бота находится ВЫШЕ клановых ролей.');
        }
    }

    // --- 3. КОМАНДА: УДАЛИТЬ КЛАН ---
    if (commandName === 'удалитьклан') {
        await interaction.deferReply({ ephemeral: true });

        if (!clanData[user.id]) {
            return interaction.editReply('❌ У вас нет созданного клана, который можно было бы удалить.');
        }

        const myClan = clanData[user.id];

        try {
            const category = guild.channels.cache.get(myClan.categoryId);
            if (category) {
                const children = guild.channels.cache.filter(c => c.parentId === category.id);
                for (const [id, child] of children) {
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

            return interaction.editReply('🗑️ Ваш клан, его роли и категория были полностью удалены. Теперь вы можете создать новый.');
        } catch (err) {
            console.error(err);
            return interaction.editReply('❌ Ошибка при удалении клана.');
        }
    }

    // --- 4. КОМАНДА: УПРАВЛЕНИЕ УЧАСТНИКАМИ ---
    if (commandName === 'клан') {
        const targetMember = interaction.options.getMember('игрок');
        const rank = interaction.options.getString('ранг');

        const authorRoles = member.roles.cache;
        const leaderRole = authorRoles.find(r => r.name.startsWith('Лидер: '));
        const officerRole = authorRoles.find(r => r.name.startsWith('Офицер: '));

        if (!leaderRole && !officerRole) {
            return interaction.reply({ content: '❌ Вы не являетесь Лидером или Офицером какого-либо клана!', ephemeral: true });
        }

        const activeClanName = leaderRole ? leaderRole.name.replace('Лидер: ', '') : officerRole.name.replace('Офицер: ', '');
        const guildRoles = guild.roles.cache;
        
        const clanBaseRole = guildRoles.find(r => r.name === activeClanName);
        const clanOfficerRole = guildRoles.find(r => r.name === `Офицер: ${activeClanName}`);
        const clanLeaderRole = guildRoles.find(r => r.name === `Лидер: ${activeClanName}`);

        if (!clanBaseRole) {
