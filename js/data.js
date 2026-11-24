const defaultProblems = [
    { id: 1, lat: -22.7858, lng: -43.3116, cat: 'Buraco na rua', status: 'Em análise', bairro: 'Centro', desc: 'Buraco grande ocupando parte da pista.', color: '#e53935' },
    { id: 2, lat: -22.7888, lng: -43.3040, cat: 'Falta de iluminação', status: 'Aberto', bairro: 'Jardim Primavera', desc: 'Poste sem iluminação durante a noite.', color: '#f5a623' },
    { id: 3, lat: -22.7920, lng: -43.3180, cat: 'Enchente', status: 'Aberto', bairro: '25 de Agosto', desc: 'Ponto de alagamento em dias de chuva.', color: '#1769e0' },
    { id: 4, lat: -22.7810, lng: -43.3188, cat: 'Falta de segurança', status: 'Resolvido', bairro: 'Centro', desc: 'Área com pouca iluminação e risco relatado.', color: '#22a06b' },
    { id: 5, lat: -22.7898, lng: -43.3140, cat: 'Buraco na rua', status: 'Aberto', bairro: 'Jardim Primavera', desc: 'Buraco próximo à calçada.', color: '#e53935' }
];

const GUEST_REPORTS_KEY = 'urbaneye_guest_reports';
const MAX_GUEST_REPORTS = 25;
const USER_CACHE_PREFIX = 'urbaneye_user_cache_v1_';
const USER_CACHE_TTL = 5 * 60 * 1000;
const userReportsRequests = new Map();
const PROBLEM_COLOR_PALETTE = new Set([
    '#e53935',
    '#f5a623',
    '#1769e0',
    '#22a06b',
    '#7a5af8'
]);

function normalizeProblemColor(color) {
    const normalized = String(color || '').trim().toLowerCase();
    return PROBLEM_COLOR_PALETTE.has(normalized) ? normalized : '#1769e0';
}

function readUserCache(type, userId) {
    try {
        const key = `${USER_CACHE_PREFIX}${type}_${userId}`;
        const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (!cached || cached.expiresAt <= Date.now()) {
            sessionStorage.removeItem(key);
            return null;
        }
        return cached.data;
    } catch (error) {
        console.warn('Não foi possível ler o cache do perfil:', error);
        return null;
    }
}

function writeUserCache(type, userId, data) {
    try {
        sessionStorage.setItem(`${USER_CACHE_PREFIX}${type}_${userId}`, JSON.stringify({
            expiresAt: Date.now() + USER_CACHE_TTL,
            data
        }));
    } catch (error) {
        console.warn('Não foi possível salvar o cache do perfil:', error);
    }
}

function invalidateCurrentUserCache() {
    const userId = window.UrbanAuth?.getUser?.()?.id;
    if (!userId) return;
    try {
        sessionStorage.removeItem(`${USER_CACHE_PREFIX}profile_${userId}`);
        sessionStorage.removeItem(`${USER_CACHE_PREFIX}reports_${userId}`);
    } catch (error) {
        console.warn('Não foi possível atualizar o cache do perfil:', error);
    }
}

function useSupabaseData() {
    return !!(window.supabaseClient && window.supabaseClient.auth && window.supabaseClient.storage && window.urbaneyeSupabaseEnabled);
}

function isAuthenticatedNow() {
    return !!(window.UrbanAuth && window.UrbanAuth.isAuthenticated && window.UrbanAuth.isAuthenticated());
}

function normalizeProblemStatus(status) {
    const value = String(status || 'Aberto').trim();
    const normalized = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (['aberto', 'reportado', 'reported', 'pendente', 'pending'].includes(normalized)) return 'Aberto';
    if (['em analise', 'analise', 'in analysis', 'in progress', 'under review'].includes(normalized)) return 'Em análise';
    if (['resolvido', 'concluido', 'completed', 'resolved'].includes(normalized)) return 'Resolvido';
    return value;
}

function normalizeProblemRow(row) {
    if (!row) return null;
    return {
        ...row,
        id: row.id,
        cat: row.category || row.cat || 'Outro',
        desc: row.description || row.desc || 'Sem descrição',
        status: normalizeProblemStatus(row.status),
        lat: Number(row.lat),
        lng: Number(row.lng),
        color: normalizeProblemColor(row.color),
        photo: row.photo_url || row.photo || null,
        bairro: row.bairro || row.neighborhood || null,
        municipality: row.municipality || null,
        confirmation_count: Number(row.confirmation_count || 0)
    };
}

function normalizeProblemPayload(problem) {
    return {
        category: problem.cat,
        description: problem.desc,
        status: normalizeProblemStatus(problem.status),
        lat: problem.lat,
        lng: problem.lng,
        color: normalizeProblemColor(problem.color),
        bairro: problem.bairro || null,
        municipality: problem.municipality || null,
        photo_url: problem.photo || null
    };
}

function readGuestReports() {
    try {
        const raw = localStorage.getItem(GUEST_REPORTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (error) {
        return [];
    }
}

function writeGuestReports(list) {
    try {
        localStorage.setItem(GUEST_REPORTS_KEY, JSON.stringify(list));
        return true;
    } catch (error) {
        console.warn('Não foi possível salvar os relatos locais:', error);
        return false;
    }
}

function saveGuestReport(report) {
    const list = readGuestReports();
    list.unshift(report);
    if (list.length > MAX_GUEST_REPORTS) list.length = MAX_GUEST_REPORTS;

    if (writeGuestReports(list)) return true;

    // Se a cota do localStorage estourar (fotos em base64), tenta salvar sem as fotos.
    const withoutPhotos = list.map((item) => item.photo ? { ...item, photo: null } : item);
    return writeGuestReports(withoutPhotos);
}

async function uploadProblemPhotoIfNeeded(dataUrl) {
    if (!dataUrl || !window.supabaseClient || !String(dataUrl).startsWith('data:image/')) return dataUrl;

    try {
        const fileName = `report-${Date.now()}.jpg`;
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const { error: uploadError } = await window.supabaseClient.storage
            .from('report-photos')
            .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) {
            console.error('Erro ao enviar foto para Supabase Storage:', uploadError);
            return dataUrl;
        }

        const { data: publicData } = window.supabaseClient.storage
            .from('report-photos')
            .getPublicUrl(fileName);

        return publicData?.publicUrl || dataUrl;
    } catch (error) {
        console.error('Erro de upload de imagem:', error);
        return dataUrl;
    }
}

async function fetchRemoteProblems() {
    if (!useSupabaseData()) return [];

    const { data, error } = await window.supabaseClient
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Erro ao buscar relatos do Supabase:', error);
        return [];
    }

    return (data || []).map(normalizeProblemRow);
}

window.normalizeProblemColor = normalizeProblemColor;

window.UrbanAPI = {
    async getProblems() {
        const remote = await fetchRemoteProblems();

        if (isAuthenticatedNow()) return remote;

        // Visitante: vê os relatos públicos + os relatos que salvou localmente.
        return [...readGuestReports(), ...remote];
    },

    async getNeighborhoodReports() {
        const reports = [];
        if (useSupabaseData()) {
            const pageSize = 1000;
            let offset = 0;

            while (true) {
                const { data, error } = await window.supabaseClient
                    .from('reports')
                    .select('id, bairro, lat, lng, municipality')
                    .order('id', { ascending: true })
                    .range(offset, offset + pageSize - 1);

                if (error) throw error;

                reports.push(...(data || []));

                if (!data || data.length < pageSize) break;
                offset += pageSize;
            }
        }

        if (!isAuthenticatedNow()) reports.push(...readGuestReports());
        return reports;
    },

    async getProblemById(id) {
        if (!isAuthenticatedNow()) {
            const local = readGuestReports().find((report) => String(report.id) === String(id));
            if (local) return local;
        }

        if (!useSupabaseData()) {
            return null;
        }

        const { data, error } = await window.supabaseClient
            .from('reports')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            console.error('Erro ao localizar relato:', error);
            return null;
        }

        return data ? normalizeProblemRow(data) : null;
    },

    async getMyReports() {
        if (!isAuthenticatedNow()) {
            return readGuestReports();
        }

        if (!useSupabaseData()) return [];

        try {
            let user = window.UrbanAuth?.getUser?.() || null;
            if (!user?.id) {
                const { data, error } = await window.supabaseClient.auth.getSession();
                if (error || !data?.session?.user) return [];
                user = data.session.user;
            }

            const cachedReports = readUserCache('reports', user.id);
            if (cachedReports) return cachedReports;
            if (userReportsRequests.has(user.id)) return await userReportsRequests.get(user.id);

            const reportsRequest = (async () => {
                const { data, error } = await window.supabaseClient
                    .from('reports')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false });

                if (error) {
                    console.error('Erro ao buscar seus relatos:', error);
                    return [];
                }

                const reports = (data || []).map(normalizeProblemRow);
                writeUserCache('reports', user.id, reports);
                return reports;
            })();
            userReportsRequests.set(user.id, reportsRequest);
            try {
                return await reportsRequest;
            } finally {
                userReportsRequests.delete(user.id);
            }
        } catch (error) {
            console.error('Erro ao buscar seus relatos:', error);
            return [];
        }
        
    },

    async deleteProblem(reportId) {
        if (!isAuthenticatedNow()) {
            const reports = readGuestReports();
            const remaining = reports.filter(
                report => String(report.id) !== String(reportId)
            );

            if (remaining.length === reports.length) return false;
            return writeGuestReports(remaining);
        }

        if (!useSupabaseData()) {
            throw new Error('Supabase não configurado.');
        }

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (sessionError || !user) {
            throw new Error('Sua sessão expirou. Entre novamente para apagar o relato.');
        }

        const { data, error } = await window.supabaseClient
            .from('reports')
            .delete()
            .eq('id', reportId)
            .eq('user_id', user.id)
            .select('id');

        if (error) throw error;
        const deleted = !!data?.length;
        if (deleted) invalidateCurrentUserCache();
        return deleted;
    },

    async getProfileData() {
        if (!isAuthenticatedNow()) {
            const reports = await this.getMyReports();
            const resolved = reports.filter((report) => report.status === 'Resolvido').length;
            return {
                name: 'Visitante',
                email: null,
                memberSince: 'Modo visitante — dados salvos neste navegador',
                avatarUrl: null,
                reports: reports.length,
                resolved,
                confirmations: 0,
                points: reports.length * 10,
                isGuest: true
            };
        }

        let user = window.UrbanAuth?.getUser?.() || null;
        if (!user?.id && useSupabaseData()) {
            const { data, error } = await window.supabaseClient.auth.getSession();
            if (error) console.warn('Não foi possível carregar a sessão do usuário:', error);
            user = data?.session?.user || user;
        }

        const cachedProfile = user?.id ? readUserCache('profile', user.id) : null;
        if (cachedProfile) return cachedProfile;

        const reports = await this.getMyReports();
        const resolved = reports.filter((report) => report.status === 'Resolvido').length;
        let fullName = '';
        let avatarUrl = null;
        if (user?.id && useSupabaseData()) {
            try {
                const { data: profile, error } = await window.supabaseClient
                    .from('profiles')
                    .select('full_name, avatar_url')
                    .eq('id', user.id)
                    .maybeSingle();
                if (error) throw error;
                fullName = profile?.full_name || '';
                avatarUrl = profile?.avatar_url || null;
            } catch (error) {
                console.warn('Não foi possível carregar o perfil:', error);
            }
        }
        fullName = fullName || user?.user_metadata?.full_name || '';

        const email = user?.email || window.UrbanAuth?.getEmail?.() || null;
        const memberSince = user?.created_at
            ? 'Conta criada em ' + new Date(user.created_at).toLocaleDateString('pt-BR')
            : 'Conta conectada';

        let confirmations = 0;
        if (useSupabaseData() && user?.id) {
            const { count, error } = await window.supabaseClient
                .from('report_confirmations')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id);
            if (!error) confirmations = count || 0;
        }

        const profile = {
            name: fullName || (email ? email.split('@')[0] : 'Usuário'),
            email,
            memberSince,
            avatarUrl,
            reports: reports.length,
            resolved,
            confirmations,
            points: reports.length * 10,
            isGuest: false
        };
        if (user?.id) writeUserCache('profile', user.id, profile);
        return profile;
    },

    async updateProfile({ fullName, avatarFile }) {
        if (!isAuthenticatedNow() || !useSupabaseData()) {
            throw new Error('Entre na sua conta para editar o perfil.');
        }

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (sessionError || !user) {
            throw new Error('Sua sessão expirou. Entre novamente para editar o perfil.');
        }

        const normalizedName = String(fullName || '').trim();
        if (!normalizedName || normalizedName.length > 80) {
            throw new Error('Informe um nome com até 80 caracteres.');
        }

        const { data: existingProfile, error: profileReadError } = await window.supabaseClient
            .from('profiles')
            .select('avatar_url')
            .eq('id', user.id)
            .maybeSingle();
        if (profileReadError) throw profileReadError;

        let avatarUrl = existingProfile?.avatar_url || null;
        if (avatarFile) {
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
            if (!allowedTypes.includes(avatarFile.type) || avatarFile.size > 5 * 1024 * 1024) {
                throw new Error('Escolha uma imagem JPG, PNG ou WebP de até 5 MB.');
            }

            const { error: uploadError } = await window.supabaseClient.storage
                .from('profile-avatars')
                .upload(`${user.id}/avatar`, avatarFile, {
                    cacheControl: '3600',
                    contentType: avatarFile.type,
                    upsert: true
                });
            if (uploadError) throw uploadError;

            const { data: publicUrl } = window.supabaseClient.storage
                .from('profile-avatars')
                .getPublicUrl(`${user.id}/avatar`);
            avatarUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
        }

        const profileChanges = {
            email: user.email,
            full_name: normalizedName,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString()
        };
        if (existingProfile) {
            const { data: updatedProfile, error: updateError } = await window.supabaseClient
                .from('profiles')
                .update(profileChanges)
                .eq('id', user.id)
                .select('id')
                .maybeSingle();
            if (updateError) throw updateError;
            if (!updatedProfile) {
                throw new Error('Não foi possível atualizar o perfil. Confira as políticas RLS da tabela profiles no Supabase.');
            }
        } else {
            const { error: insertError } = await window.supabaseClient
                .from('profiles')
                .insert({ id: user.id, ...profileChanges });
            if (insertError) throw insertError;
        }

        try {
            sessionStorage.removeItem(`${USER_CACHE_PREFIX}profile_${user.id}`);
        } catch (error) {
            console.warn('Não foi possível atualizar o cache do perfil:', error);
        }
        return { name: normalizedName, avatarUrl };
    },

    async getNotifications() {
        if (!isAuthenticatedNow() || !useSupabaseData()) {
            throw new Error('Entre em uma conta conectada ao Supabase para ver as notificações.');
        }

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (sessionError || !user) {
            throw new Error('Sua sessão expirou. Entre novamente para ver as notificações.');
        }

        const { data, error } = await window.supabaseClient
            .from('notifications')
            .select('id, report_id, title, message, created_at, read_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        return data || [];
    },

    async markNotificationsRead() {
        if (!isAuthenticatedNow() || !useSupabaseData()) {
            throw new Error('Entre em uma conta conectada ao Supabase para atualizar as notificações.');
        }

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (sessionError || !user) {
            throw new Error('Sua sessão expirou. Entre novamente para atualizar as notificações.');
        }

        const { data, error } = await window.supabaseClient
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .is('read_at', null)
            .select('id');

        if (error) throw error;
        return data?.length || 0;
    },

    async getNotificationPreference() {
        if (!isAuthenticatedNow() || !useSupabaseData()) {
            throw new Error('Entre em uma conta conectada ao Supabase para configurar notificações.');
        }

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (sessionError || !user) {
            throw new Error('Sua sessão expirou. Entre novamente para configurar notificações.');
        }

        const { data, error } = await window.supabaseClient
            .from('profiles')
            .select('notifications_enabled')
            .eq('id', user.id)
            .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error('Perfil não encontrado. Atualize o perfil antes de alterar as notificações.');
        return data.notifications_enabled !== false;
    },

    async setNotificationPreference(enabled) {
        if (typeof enabled !== 'boolean') {
            throw new Error('A preferência de notificações é inválida.');
        }
        if (!isAuthenticatedNow() || !useSupabaseData()) {
            throw new Error('Entre em uma conta conectada ao Supabase para configurar notificações.');
        }

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (sessionError || !user) {
            throw new Error('Sua sessão expirou. Entre novamente para configurar notificações.');
        }

        const { data, error } = await window.supabaseClient
            .from('profiles')
            .update({ notifications_enabled: enabled })
            .eq('id', user.id)
            .select('id')
            .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error('Não foi possível salvar a preferência de notificações do perfil.');
        return enabled;
    },

    async addProblem(problem) {
        if (!isAuthenticatedNow()) {
            const report = normalizeProblemRow({
                id: 'guest-' + Date.now(),
                category: problem.cat,
                description: problem.desc,
                status: problem.status || 'Aberto',
                lat: problem.lat,
                lng: problem.lng,
                color: normalizeProblemColor(problem.color),
                bairro: problem.bairro || null,
                municipality: problem.municipality || null,
                photo_url: problem.photo || null,
                created_at: new Date().toISOString(),
                is_guest: true
            });

            const saved = saveGuestReport(report);
            if (!saved) {
                throw new Error('Não foi possível salvar o relato neste navegador. O armazenamento local pode estar cheio.');
            }

            return report;
        }

        if (!useSupabaseData()) {
            throw new Error('Supabase não configurado. Configure a URL e a chave do projeto para salvar a denúncia.');
        }

        const { data: userData, error: userError } = await window.supabaseClient.auth.getUser();
        if (userError || !userData?.user) {
            throw new Error('Você precisa estar autenticado no Supabase para salvar a denúncia.');
        }

        const photoUrl = await uploadProblemPhotoIfNeeded(problem.photo);
        const { data, error } = await window.supabaseClient
            .from('reports')
            .insert({
                ...normalizeProblemPayload({ ...problem, photo: photoUrl }),
                user_id: userData.user.id
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        invalidateCurrentUserCache();
        return normalizeProblemRow(data);
    },

    async getStats() {
        const data = await this.getProblems();
        return {
            total: data.length,
            resolved: data.filter(p => p.status === 'Resolvido').length,
            analysis: data.filter(p => p.status === 'Em análise').length,
            open: data.filter(p => p.status === 'Aberto').length
        };
    },

    async getProblemConfirmationCount(reportId) {
        if (!useSupabaseData()) return 0;

        const { count, error } = await window.supabaseClient
            .from('report_confirmations')
            .select('*', { count: 'exact', head: true })
            .eq('report_id', reportId);

        if (error) {
            console.error('Erro ao buscar confirmações do relato:', error);
            return 0;
        }
        return count || 0;
    },

    async hasConfirmedProblem(reportId) {
        if (!useSupabaseData() || !isAuthenticatedNow()) return false;

        const { data: userData } = await window.supabaseClient.auth.getUser();
        const user = userData?.user;
        if (!user) return false;

        const { data, error } = await window.supabaseClient
            .from('report_confirmations')
            .select('report_id')
            .eq('report_id', reportId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (error) {
            console.error('Erro ao verificar confirmação:', error);
            return false;
        }
        return !!data;
    },

    async confirmProblem(reportId) {
        if (!useSupabaseData()) {
            toast('O Supabase precisa estar configurado para confirmar problemas.');
            return null;
        }

        const { data: userData, error: userError } = await window.supabaseClient.auth.getUser();
        const user = userData?.user;
        if (userError || !user) {
            requireLogin();
            return null;
        }

        const { error } = await window.supabaseClient
            .from('report_confirmations')
            .insert({ report_id: reportId, user_id: user.id });

        if (error && error.code !== '23505') {
            console.error('Erro ao confirmar problema:', error);
            toast('Não foi possível confirmar o problema.');
            return null;
        }

        const count = await this.getProblemConfirmationCount(reportId);
        invalidateCurrentUserCache();
        return {
            count,
            alreadyConfirmed: error?.code === '23505'
        };
    },

    async updateProblemStatus(reportId, status) {
        const normalizedStatus = normalizeProblemStatus(status);
        if (!['Aberto', 'Em análise', 'Resolvido'].includes(normalizedStatus)) {
            throw new Error('Situação inválida para o relato.');
        }
        if (!isAuthenticatedNow() || !useSupabaseData()) {
            throw new Error('Entre na sua conta para atualizar a situação do relato.');
        }

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (sessionError || !user) {
            throw new Error('Sua sessão expirou. Entre novamente para atualizar a situação.');
        }

        const { data, error } = await window.supabaseClient
            .from('reports')
            .update({ status: normalizedStatus })
            .eq('id', reportId)
            .select('id, status')
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            throw new Error('Não foi possível atualizar. Sua conta não tem permissão para alterar este relato.');
        }

        invalidateCurrentUserCache();
        return normalizeProblemStatus(data.status);
    },

    async updateProblemDetails(reportId, { category, description }) {
        const allowedCategories = [
            'Buraco na rua',
            'Falta de iluminação',
            'Enchente',
            'Falta de segurança',
            'Outro'
        ];
        const normalizedCategory = String(category || '').trim();
        const normalizedDescription = String(description || '').trim();
        if (!allowedCategories.includes(normalizedCategory)) {
            throw new Error('Selecione uma categoria válida.');
        }
        if (!normalizedDescription || normalizedDescription.length > 2000) {
            throw new Error('A descrição deve ter entre 1 e 2000 caracteres.');
        }
        if (!isAuthenticatedNow()) {
            const reports = readGuestReports();
            const reportIndex = reports.findIndex((report) => String(report.id) === String(reportId));
            if (reportIndex < 0) {
                throw new Error('Relato não encontrado no armazenamento local.');
            }

            reports[reportIndex] = {
                ...reports[reportIndex],
                category: normalizedCategory,
                description: normalizedDescription
            };
            if (!writeGuestReports(reports)) {
                throw new Error('Não foi possível salvar as alterações neste navegador.');
            }
            return normalizeProblemRow(reports[reportIndex]);
        }
        if (!useSupabaseData()) {
            throw new Error('Entre na sua conta para editar este relato.');
        }

        const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (sessionError || !user) {
            throw new Error('Sua sessão expirou. Entre novamente para editar o relato.');
        }

        const { data, error } = await window.supabaseClient
            .from('reports')
            .update({
                category: normalizedCategory,
                description: normalizedDescription
            })
            .eq('id', reportId)
            .eq('user_id', user.id)
            .select('*')
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            throw new Error('Não foi possível editar. Apenas quem publicou o relato pode alterá-lo.');
        }

        invalidateCurrentUserCache();
        return normalizeProblemRow(data);
    },

    isGuest: () => !isAuthenticatedNow(),
    getGuestReports: readGuestReports
};

const UrbanAPI = window.UrbanAPI;
