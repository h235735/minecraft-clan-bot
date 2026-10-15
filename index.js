const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Подключено к MongoDB'))
    .catch(err => console.error('❌ Ошибка MongoDB:', err));

const clanSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    clanName: String,
    categoryId: String,
    baseRoleId: String,
    officerRoleId: String,
    leaderRoleId: String
});
const Clan = mongoose.model('Clan', clanSchema);

async function getClan(userId) { return await Clan.findOne({ userId }); }
async function saveClan(userId, data) { return await Clan.findOneAndUpdate({ userId }, data, { upsert: true, new: true }); }
async function deleteClan(userId) { return await Clan.findOneAndDelete({ userId }); }
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
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Слэш-команды обновлены!');
    } catch (e) { console.error(e); }
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
            const category = guild.channels.cache.get(myClan.categoryId);
            if (category) await category.setName(`⛺ КЛАН: ${newName.toUpperCase()}`);
            const br = guild.roles.cache.get(myClan.baseRoleId); if (br) await br.setName(newName);
            const or = guild.roles.cache.get(myClan.officerRoleId); if (or) await or.setName(`Офицер: ${newName}`);
            const lr = guild.roles.cache.get(myClan.leaderRoleId); if (lr) await lr.setName(`Лидер: ${newName}`);
            myClan.clanName = newName;
            await myClan.save();
            return interaction.editReply(`📝 Клан переименован в **${newName}**!`);
        } catch (err) { console.error(err); return interaction.editReply('❌ Ошибка переименования.'); }
    }

    // --- УДАЛИТЬ ---
    if (commandName === 'удалитьклан') {
        await interaction.deferReply({ ephemeral: true });
        const myClan = await getClan(user.id);
        if (!myClan) return interaction.editReply('❌ У вас нет клана.');
        try {
            const category = guild.channels.cache.get(myClan.categoryId);
            if (category) {
                const children = guild.channels.cache.filter(c => c.parentId === category.id);
                for (const [, child] of children) await child.delete().catch(() => null);
                await category.delete().catch(() => null);
            }
            for (const id of [myClan.baseRoleId, myClan.officerRoleId, myClan.leaderRoleId]) {
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

        // Ищем клан по ролям автора
        let myClan = null;
        const allClans = await Clan.find({});
        for (const c of allClans) {
            if (member.roles.cache.has(c.leaderRoleId) || member.roles.cache.has(c.officerRoleId)) {
                myClan = c; break;
            }
        }
        if (!myClan) return interaction.reply({ content: '❌ Вы не Лидер и не Офицер.', ephemeral: true });

        const isLeader = member.roles.cache.has(myClan.leaderRoleId);
        const br = guild.roles.cache.get(myClan.baseRoleId);
        const or = guild.roles.cache.get(myClan.officerRoleId);
        const lr = guild.roles.cache.get(myClan.leaderRoleId);

        if (!br) return interaction.reply({ content: '❌ Роль клана удалена.', ephemeral: true });

        await interaction.deferReply();
        try {
            if (rank === 'member') {
                await target.roles.add(br);
                return interaction.editReply(`✅ ${target} — Боец клана **${myClan.clanName}**.`);
            }
            if (rank === 'officer') {
                if (!isLeader) return interaction.editReply('❌ Только Лидер может назначать Офицеров!');
                await target.roles.add(br); await target.roles.add(or);
                return interaction.editReply(`👑 ${target} — Офицер клана **${myClan.clanName}**.`);
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
                return interaction.editReply(`🚪 ${target} исключён из клана **${myClan.clanName}**.`);
            }
        } catch (err) { console.error(err); return interaction.editReply('❌ Ошибка. Роль бота должна быть ВЫШЕ.'); }
    }
});

client.login(process.env.TOKEN);
