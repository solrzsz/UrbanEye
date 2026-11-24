-- UrbanEye: habilitar conta institucional da prefeitura.
-- Primeiro crie o usuário em Supabase > Authentication > Users.
-- Substitua o e-mail abaixo pelo mesmo e-mail cadastrado no Supabase Auth.

do $$
declare
  institutional_email text := lower(trim('prefeitura@seudominio.gov.br'));
  institutional_user_id uuid;
begin
  select id
    into institutional_user_id
    from auth.users
    where lower(email) = institutional_email;

  if institutional_user_id is null then
    raise exception 'Usuário % não encontrado em Authentication > Users. Crie-o no Supabase Auth e execute novamente.', institutional_email;
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (
    institutional_user_id,
    'Administração da Prefeitura',
    institutional_email,
    'municipal'
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        role = 'municipal',
        updated_at = now();
end;
$$;

-- Impede usuários comuns de definir ou alterar o próprio papel institucional.
revoke insert, update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (id, full_name, email, avatar_url, created_at, updated_at)
  on public.profiles to authenticated;
grant update (full_name, email, avatar_url, updated_at)
  on public.profiles to authenticated;
