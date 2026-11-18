const defaultProblems = [
    { id: 1, lat: -22.7858, lng: -43.3116, cat: 'Buraco na rua', status: 'Em análise', bairro: 'Centro', desc: 'Buraco grande ocupando parte da pista.', color: '#e53935' },
    { id: 2, lat: -22.7888, lng: -43.3040, cat: 'Falta de iluminação', status: 'Aberto', bairro: 'Jardim Primavera', desc: 'Poste sem iluminação durante a noite.', color: '#f5a623' },
    { id: 3, lat: -22.7920, lng: -43.3180, cat: 'Enchente', status: 'Aberto', bairro: '25 de Agosto', desc: 'Ponto de alagamento em dias de chuva.', color: '#1769e0' },
    { id: 4, lat: -22.7810, lng: -43.3188, cat: 'Falta de segurança', status: 'Resolvido', bairro: 'Centro', desc: 'Área com pouca iluminação e risco relatado.', color: '#22a06b' },
    { id: 5, lat: -22.7898, lng: -43.3140, cat: 'Buraco na rua', status: 'Aberto', bairro: 'Jardim Primavera', desc: 'Buraco próximo à calçada.', color: '#e53935' }
];

function useSupabaseData() {
    return !!(window.supabaseClient && window.supabaseClient.auth && window.supabaseClient.storage && window.urbaneyeSupabaseEnabled);
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

window.UrbanAPI = {
    async getProblems() {
        if (!useSupabaseData()) {
            console.warn('Supabase não configurado. Nenhum dado será carregado em modo local.');
            return [];
        }

        const { data, error } = await window.supabaseClient
            .from('reports')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Erro ao buscar relatos do Supabase:', error);
            return [];
        }

        return (data || []).map(normalizeProblemRow);
    },

    async getProblemById(id) {
        if (!useSupabaseData()) {
            console.warn('Supabase não configurado. Nenhum relato será carregado em modo local.');
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

    async addProblem(problem) {
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
    }
};

const UrbanAPI = window.UrbanAPI;
