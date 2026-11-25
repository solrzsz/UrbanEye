(function () {
  'use strict';

  let profileAvatarPreviewUrl = null;

  async function renderProfileHeader() {
    const data = await UrbanAPI.getProfileData();
  
    const name = document.getElementById('profileName');
    if (name) name.textContent = data.name;
    const nameInput = document.getElementById('profileNameInput');
    if (nameInput) nameInput.value = data.name === 'Visitante' ? '' : data.name;
  
    const memberSince = document.getElementById('profileMemberSince');
    if (memberSince) memberSince.textContent = data.memberSince;
  
    const avatar = document.querySelector('.profile-avatar') || document.querySelector('.avatar');
    if (avatar) {
      avatar.replaceChildren();
      if (data.avatarUrl) {
        const image = document.createElement('img');
        image.src = data.avatarUrl;
        image.alt = `Foto de perfil de ${data.name}`;
        avatar.appendChild(image);
      } else {
        avatar.textContent = (data.name || 'V').trim().charAt(0).toUpperCase();
      }
    }
  
    const fields = [
      ['profileReports', data.reports],
      ['profileResolved', data.resolved],
      ['profileConfirmations', data.confirmations],
      ['profilePoints', data.points]
    ];
  
    fields.forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
  }

  function previewProfileAvatar(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      input.value = '';
      toast('Escolha uma imagem JPG, PNG ou WebP de até 5 MB.');
      return;
    }
  
    const avatar = document.getElementById('profileAvatar');
    if (!avatar) return;
    if (profileAvatarPreviewUrl) URL.revokeObjectURL(profileAvatarPreviewUrl);
    profileAvatarPreviewUrl = URL.createObjectURL(file);
    const image = document.createElement('img');
    image.src = profileAvatarPreviewUrl;
    image.alt = 'Prévia da foto de perfil';
    avatar.replaceChildren(image);
  }

  async function saveProfile() {
    const nameInput = document.getElementById('profileNameInput');
    const photoInput = document.getElementById('profileAvatarInput');
    const button = document.getElementById('saveProfileButton');
    const fullName = nameInput ? nameInput.value.trim() : '';
    const avatarFile = photoInput?.files?.[0] || null;
  
    if (!fullName) {
      toast('Informe seu nome.');
      nameInput?.focus();
      return;
    }
  
    if (fullName.length > 80) {
      toast('O nome deve ter no máximo 80 caracteres.');
      return;
    }
  
    if (button) {
      button.disabled = true;
      button.textContent = 'Salvando...';
    }
  
    try {
      await UrbanAPI.updateProfile({ fullName, avatarFile });
      if (profileAvatarPreviewUrl) {
        URL.revokeObjectURL(profileAvatarPreviewUrl);
        profileAvatarPreviewUrl = null;
      }
      if (photoInput) photoInput.value = '';
      await renderProfileHeader();
      const editor = document.getElementById('profileEditor');
      const editButton = document.getElementById('editProfileButton');
      if (editor) editor.hidden = true;
      if (editButton) editButton.hidden = false;
      toast('Perfil atualizado com sucesso!');
    } catch (error) {
      console.error('Erro ao atualizar perfil:', error);
      toast(error?.message || 'Não foi possível atualizar o perfil.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Salvar perfil';
      }
    }
  }

  function openProfileEditor() {
    const editor = document.getElementById('profileEditor');
    const button = document.getElementById('editProfileButton');
    if (editor) editor.hidden = false;
    if (button) button.hidden = true;
    document.getElementById('profileNameInput')?.focus();
  }

  async function closeProfileEditor() {
    const editor = document.getElementById('profileEditor');
    const button = document.getElementById('editProfileButton');
    const photoInput = document.getElementById('profileAvatarInput');
    if (editor) editor.hidden = true;
    if (button) button.hidden = false;
    if (photoInput) photoInput.value = '';
    if (profileAvatarPreviewUrl) {
      URL.revokeObjectURL(profileAvatarPreviewUrl);
      profileAvatarPreviewUrl = null;
    }
    await renderProfileHeader();
  }

  Object.assign(window, {previewProfileAvatar, saveProfile, openProfileEditor, closeProfileEditor});

  onAppReady(async () => {
  await renderProfileHeader();
  if (document.getElementById('profileHistoryBox')) await renderHistory('profileHistoryBox', 3);
});
})();
