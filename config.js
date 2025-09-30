const currentUrl = new URL(window.location.href);
const redirectBase = new URL('.', currentUrl).href;

window.__FLOWSEAT_CONFIG = {
  baseUrl: redirectBase,
  supabase: {
    url: 'https://bxaiotsfclcgihbbyleh.supabase.co',
    anonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4YWlvdHNmY2xjZ2loYmJ5bGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4Njk1MTksImV4cCI6MjA3NDQ0NTUxOX0.ysxnYzzd9w0oyCltlLVJmojhuzmbUgwlHjC3auKapGg',
    redirectTo: redirectBase,
    prompt: 'select_account',
  },
};


