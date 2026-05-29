import Vue from 'vue'
import Vuetify from 'vuetify/lib'
import 'vuetify/dist/vuetify.min.css'

Vue.use(Vuetify)

const opts = {
  theme: {
    dark: Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches),
    themes: {
      light: {
        primary: '#4361ee',
        secondary: '#3a86ff',
        accent: '#f77f00',
        error: '#d62828',
        warning: '#f4a261',
        info: '#4895ef',
        success: '#2d9e5f',
        background: '#f0f4ff',
      },
      dark: {
        primary: '#4895ef',
        secondary: '#4361ee',
        accent: '#f77f00',
        error: '#e63946',
        warning: '#f4a261',
        info: '#4cc9f0',
        success: '#2ec4b6',
        background: '#0d1117',
      }
    },
    options: {
      customProperties: true,
    },
  }
}

export default new Vuetify(opts)
