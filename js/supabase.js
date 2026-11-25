(function () {
  const defaultUrl = 'https://swmgwteywwtaggrznbkj.supabase.co';
  const defaultAnonKey = 'sb_publishable_0pmwIcDcS1P30gNZ3f6-3Q_MpUzhvjU';

  const configuredUrl = String(window.urbaneyeSupabaseUrl || '').trim() || defaultUrl;
  const configuredAnonKey = String(window.urbaneyeSupabaseAnonKey || '').trim() || defaultAnonKey;
  const hasRealSupabaseConfig = configuredUrl.startsWith('https://') && configuredAnonKey.length > 20;

  window.urbaneyeSupabaseUrl = configuredUrl;
  window.urbaneyeSupabaseAnonKey = configuredAnonKey;
  window.urbaneyeSupabaseEnabled = hasRealSupabaseConfig;

  if (!window.supabase) {
    console.warn('Supabase JS SDK não foi carregado. Inclua o script do Supabase antes dos scripts do aplicativo.');
    window.supabaseClient = null;
    return;
  }

  if (!hasRealSupabaseConfig) {
    console.warn('Supabase ainda não foi configurado. O app continuará em modo local até preencher a URL e a chave anônima do projeto.');
    window.supabaseClient = null;
    return;
  }

  window.supabaseClient = window.supabase.createClient(configuredUrl, configuredAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  window.supabase = window.supabaseClient;

  async function signUp(email, password) {
    const client = window.supabaseClient || window.supabase;
    if (!client || !client.auth) {
      console.warn('Supabase não inicializado. Não foi possível cadastrar o usuário.');
      return null;
    }

    const { data, error } = await client.auth.signUp({ email, password });
    if (error) console.error('Erro no cadastro:', error.message);
    return data;
  }

  async function signIn(email, password) {
    const client = window.supabaseClient || window.supabase;
    if (!client || !client.auth) {
      console.warn('Supabase não inicializado. Não foi possível fazer login.');
      return null;
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) console.error('Erro no login:', error.message);
    return data;
  }

  async function getCurrentUser() {
    const client = window.supabaseClient || window.supabase;
    if (!client || !client.auth) {
      console.warn('Supabase não inicializado. Não foi possível obter o usuário atual.');
      return null;
    }

    const { data: { user } } = await client.auth.getUser();
    return user;
  }

  async function uploadPhoto(file) {
    const client = window.supabaseClient || window.supabase;
    if (!client || !client.storage) {
      throw new Error('Supabase Storage não inicializado.');
    }

    if (!file) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt || 'jpg'}`;
    const filePath = `${fileName}`;

    const { data, error } = await client.storage
      .from('report-photos')
      .upload(filePath, file);

    if (error) throw error;

    const { data: publicUrlData } = client.storage
      .from('report-photos')
      .getPublicUrl(filePath);

    return publicUrlData?.publicUrl || null;
  }

  async function createReport(cat, desc, lat, lng, bairro, color, photoFile) {
    const client = window.supabaseClient || window.supabase;
    if (!client || !client.auth || !client.from) {
      alert('Você precisa configurar o Supabase para enviar relatos.');
      return null;
    }

    const user = await getCurrentUser();
    if (!user) {
      alert('Você precisa estar logado para enviar um relato.');
      return null;
    }

    let photo = null;
    if (photoFile) {
      photo = await uploadPhoto(photoFile);
    }

    const { data, error } = await client
      .from('reports')
      .insert([
        {
          category: cat,
          description: desc,
          lat: lat,
          lng: lng,
          bairro: bairro,
          color: color,
          photo_url: photo,
          status: 'Aberto',
          user_id: user.id
        }
      ])
      .select();

    if (error) {
      console.error('Erro ao criar relato:', error);
      return null;
    }

    return data;
  }

  async function fetchReports() {
    const client = window.supabaseClient || window.supabase;
    if (!client || !client.from) {
      console.warn('Supabase não inicializado. Nenhum relato foi carregado.');
      return [];
    }

    const { data: reports, error } = await client
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao carregar relatos:', error);
      return [];
    }

    return reports || [];
  }

  window.signUp = signUp;
  window.signIn = signIn;
  window.getCurrentUser = getCurrentUser;
  window.uploadPhoto = uploadPhoto;
  window.createReport = createReport;
  window.fetchReports = fetchReports;
})();
