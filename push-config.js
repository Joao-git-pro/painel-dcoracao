// =====================================================================
// CONFIGURAÇÃO DAS NOTIFICAÇÕES COM O APP FECHADO (push)
// Preencha as duas linhas abaixo (veja o arquivo CONFIGURAR-NOTIFICACOES.txt)
// e publique de novo. Enquanto estiverem vazias, o painel funciona normal,
// só que os avisos chegam apenas com o painel aberto.
// =====================================================================
window.PUSH_CONFIG = {
  // Firebase Console > Configurações do projeto > Cloud Messaging >
  // Certificados push da Web > "Par de chaves" (começa com B...)
  vapidKey: 'BGdaF7AcAcC4wZ64krZLfmtrTcOg9Hq2oWAiTuixL1P2RGzNgh3v8IMXWxDxNgzu7WLVTOoyxv1O8mnNCMkz1cg',
  // Apps Script > Implantar > Aplicativo da Web > URL (termina com /exec)
  scriptUrl: ''
};
