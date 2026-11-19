const defaultProblems = [
    { id: 1, lat: -22.7858, lng: -43.3116, cat: 'Buraco na rua', status: 'Em análise', bairro: 'Centro', desc: 'Buraco grande ocupando parte da pista.', color: '#e53935' },
    { id: 2, lat: -22.7888, lng: -43.3040, cat: 'Falta de iluminação', status: 'Aberto', bairro: 'Jardim Primavera', desc: 'Poste sem iluminação durante a noite.', color: '#f5a623' },
    { id: 3, lat: -22.7920, lng: -43.3180, cat: 'Enchente', status: 'Aberto', bairro: '25 de Agosto', desc: 'Ponto de alagamento em dias de chuva.', color: '#1769e0' },
    { id: 4, lat: -22.7810, lng: -43.3188, cat: 'Falta de segurança', status: 'Resolvido', bairro: 'Centro', desc: 'Área com pouca iluminação e risco relatado.', color: '#22a06b' },
    { id: 5, lat: -22.7898, lng: -43.3140, cat: 'Buraco na rua', status: 'Aberto', bairro: 'Jardim Primavera', desc: 'Buraco próximo à calçada.', color: '#e53935' }
];

const GUEST_REPORTS_KEY = 'urbaneye_guest_reports';
const MAX_GUEST_REPORTS = 25;

function useSupabaseData() {
    return !!(window.supabaseClient && window.supabaseClient.auth && window.supabaseClient.storage && window.urbaneyeSupabaseEnabled);
}

function isAuthenticatedNow() {
    return !!(window.UrbanAuth && window.UrbanAuth.isAuthenticated && window.UrbanAuth.isAuthenticated());
}

function normalizeProblemRow(row) {
    if (!row) return null;
    return {
        ...row,
        id: row.id,
        cat: row.category || row.cat || 'Outro',
        desc: row.description || row.desc || 'Sem descrição',
        status: row.status || 'Aberto',
        lat: Number(row.lat),
        lng: Number(row.lng),
        color: row.color || '#1769e0',
        photo: row.photo_url || row.photo || null,
        bairro: row.bairro || row.neighborhood || null
    };
}

function normalizeProblemPayload(problem) {
    return {
        category: problem.cat,
        description: problem.desc,
        status: problem.status,
        lat: problem.lat,
        lng: problem.lng,
        color: problem.color || '#1769e0',
        bairro: problem.bairro || null,
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

window.UrbanAPI = {
    async getProblems() {
        const remote = await fetchRemoteProblems();

        if (isAuthenticatedNow()) return remote;

        // Visitante: vê os relatos públicos + os relatos que salvou localmente.
        return [...readGuestReports(), ...remote];
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
            const { data: userData, error: userError } = await window.supabaseClient.auth.getUser();
            if (userError || !userData?.user) return [];

            const { data, error } = await window.supabaseClient
                .from('reports')
                .select('*')
                .eq('user_id', userData.user.id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Erro ao buscar seus relatos:', error);
                return [];
            }

            return (data || []).map(normalizeProblemRow);
        } catch (error) {
            console.error('Erro ao buscar seus relatos:', error);
            return [];
        }
    },

    async getProfileData() {
        const reports = await this.getMyReports();
        const resolved = reports.filter((report) => report.status === 'Resolvido').length;

        if (!isAuthenticatedNow()) {
            return {
                name: 'Visitante',
                email: null,
                memberSince: 'Modo visitante — dados salvos neste navegador',
                reports: reports.length,
                resolved,
                confirmations: 0,
                points: reports.length * 10,
                isGuest: true
            };
        }

        let user = null;
        try {
            const { data } = await window.supabaseClient.auth.getUser();
            user = data?.user || null;
        } catch (error) {
            console.warn('Não foi possível carregar o usuário:', error);
        }

        let fullName = user?.user_metadata?.full_name || '';
        if (!fullName && user?.id && useSupabaseData()) {
            try {
                const { data: profile } = await window.supabaseClient
                    .from('profiles')
                    .select('full_name')
                    .eq('id', user.id)
                    .maybeSingle();
                fullName = profile?.full_name || '';
            } catch (error) {
                console.warn('Não foi possível carregar o perfil:', error);
            }
        }

        const email = user?.email || null;
        const memberSince = user?.created_at
            ? 'Conta criada em ' + new Date(user.created_at).toLocaleDateString('pt-BR')
            : 'Conta conectada';

        return {
            name: fullName || (email ? email.split('@')[0] : 'Usuário'),
            email,
            memberSince,
            reports: reports.length,
            resolved,
            confirmations: 0,
            points: reports.length * 10,
            isGuest: false
        };
    },

    async getNotifications() {
        // Notificações ainda são demonstrativas para todos os perfis.
        return [
            { title: 'Problema atualizado', text: 'Seu relato de iluminação foi marcado como resolvido.', read: false },
            { title: 'Novo problema perto de você', text: 'Um novo buraco foi reportado no Centro.', read: false },
            { title: 'Você ganhou pontos!', text: 'Sua participação ajudou a comunidade.', read: false }
        ];
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
                color: problem.color || '#1769e0',
                bairro: problem.bairro || null,
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

    isGuest: () => !isAuthenticatedNow(),
    getGuestReports: readGuestReports
};

const UrbanAPI = window.UrbanAPI;
