/**
 * ========================================================================================
 * ANTIGRAVITY SCORM 1.2 ENTEGRASYON MODÜLÜ (scorm-api.js)
 * ========================================================================================
 * SCORM 1.2 Standardı ile %100 Uyumlu, Sessiz Loglamalı, Standalone Destekli İletişim Katmanı.
 * EBA LMS Cross-Origin Iframe ve Sandboxed Güvenlik Korumalı.
 * ========================================================================================
 */

(function (global) {
  'use strict';

  var apiHandle = null;
  var isInitialized = false;
  var isStandalone = false;

  /**
   * LMS SCORM 1.2 API Nesnesini Pencere Hiyerarşisinde Ara (window, parent, top, opener)
   * Cross-Origin (CORS) hatalarını engellemek için her erişim try-catch ile sarılmıştır.
   */
  function findAPI(win) {
    var attempts = 0;

    while (win && attempts < 10) {
      try {
        if (win.API) {
          return win.API;
        }
      } catch (e) {
        console.warn('[SCORM API] win.API erişiminde güvenlik engeli (cross-origin):', e);
        break;
      }

      try {
        if (win.parent && win.parent !== win) {
          win = win.parent;
          attempts++;
        } else {
          break;
        }
      } catch (e) {
        console.warn('[SCORM API] win.parent erişiminde güvenlik engeli (cross-origin):', e);
        break;
      }
    }

    try {
      if (window.opener) {
        win = window.opener;
        attempts = 0;
        while (win && attempts < 10) {
          try {
            if (win.API) {
              return win.API;
            }
          } catch (e) {
            break;
          }
          try {
            if (win.parent && win.parent !== win) {
              win = win.parent;
              attempts++;
            } else {
              break;
            }
          } catch (e) {
            break;
          }
        }
      }
    } catch (e) {
      console.warn('[SCORM API] window.opener erişiminde güvenlik engeli:', e);
    }

    return null;
  }

  function getAPI() {
    if (apiHandle) return apiHandle;

    // file:// protokolü kontrolü:
    // Dosya yerel diskten doğrudan açıldığında (file:///...), Chromium/Edge tarayıcıları
    // her file:// kaynağını benzersiz/opak güvenlik kaynağı kabul eder ve win.parent / window.opener
    // aramasında konsola "Unsafe attempt to load URL ... 'file:' URLs are treated as unique security origins" uyarısı basar.
    // Yerel dosya sisteminde zaten bir LMS sunucusu bulunamayacağından,
    // doğrudan bağımsız (standalone/offline) moda geçerek bu güvenlik uyarısını engelliyoruz:
    if (window.location && window.location.protocol === 'file:') {
      isStandalone = true;
      console.log('[SCORM API] Yerel dosya sistemi (file://) tespit edildi. Güvenli çevrim dışı (standalone) mod devrede.');
      return null;
    }

    try {
      apiHandle = findAPI(window);
    } catch (e) {
      console.warn('[SCORM API] findAPI hatası:', e);
      apiHandle = null;
    }

    if (!apiHandle) {
      isStandalone = true;
      console.log('[SCORM API] LMS API nesnesi bulunamadı. Uygulama bağımsız (standalone/offline) modda çalışıyor.');
    }
    return apiHandle;
  }

  var ScormAPI = {
    /**
     * SCORM 1.2 Oturumunu Başlat (LMSInitialize)
     */
    init: function () {
      try {
        var api = getAPI();
        if (!api) return false;
        if (isInitialized) return true;

        var result = api.LMSInitialize('');
        if (result === 'true' || result === true) {
          isInitialized = true;
          console.log('[SCORM API] LMSInitialize başarılı.');

          // Ders durumu önceden verilmediyse incomplete olarak işaretle
          try {
            var currentStatus = api.LMSGetValue('cmi.core.lesson_status');
            if (!currentStatus || currentStatus === 'not attempted' || currentStatus === 'unknown') {
              api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
              api.LMSCommit('');
            }
          } catch (err) {
            console.warn('[SCORM API] lesson_status ayarlama hatası:', err);
          }
          return true;
        } else {
          var errorCode = api.LMSGetLastError ? api.LMSGetLastError() : 'bilinmiyor';
          console.warn('[SCORM API] LMSInitialize başarısız. Hata Kodu:', errorCode);
        }
      } catch (e) {
        console.warn('[SCORM API] LMSInitialize sırasında istisna:', e);
      }
      return false;
    },

    /**
     * cmi.suspend_data İçeriğini Oku
     */
    getSuspendData: function () {
      try {
        var api = getAPI();
        if (!api || !isInitialized) return null;
        var data = api.LMSGetValue('cmi.suspend_data');
        if (data && data !== '' && data !== 'null') {
          console.log('[SCORM API] suspend_data okundu.');
          return JSON.parse(data);
        }
      } catch (e) {
        console.warn('[SCORM API] suspend_data okuma hatası:', e);
      }
      return null;
    },

    /**
     * İlerleme Durumunu Sakla (cmi.suspend_data)
     */
    saveSuspendData: function (stateObj) {
      try {
        var api = getAPI();
        if (!api || !isInitialized) return false;
        var jsonStr = JSON.stringify(stateObj);
        api.LMSSetValue('cmi.suspend_data', jsonStr);
        api.LMSCommit('');
        console.log('[SCORM API] suspend_data kaydedildi.');
        return true;
      } catch (e) {
        console.warn('[SCORM API] suspend_data kaydetme hatası:', e);
      }
      return false;
    },

    /**
     * cmi.suspend_data İçeriğini Temizle / Sıfırla
     */
    clearSuspendData: function () {
      try {
        var api = getAPI();
        if (!api || !isInitialized) return false;
        api.LMSSetValue('cmi.suspend_data', '');
        api.LMSCommit('');
        console.log('[SCORM API] suspend_data sıfırlandı.');
        return true;
      } catch (e) {
        console.warn('[SCORM API] suspend_data temizleme hatası:', e);
      }
      return false;
    },

    /**
     * Puan Normalizasyonu ve Başarı Durumu İletimi (0 - 100 Aralığı, 70 Geçme Barajı)
     */
    commitScore: function (rawScore) {
      try {
        var api = getAPI();
        var score = Math.max(0, Math.min(100, Math.round(rawScore)));
        var status = (score >= 70) ? 'passed' : 'failed';

        console.log('[SCORM API] Puan İşleniyor: Raw Score = ' + score + ' / 100, Statü = ' + status);

        if (!api || !isInitialized) return false;

        api.LMSSetValue('cmi.core.score.min', '0');
        api.LMSSetValue('cmi.core.score.max', '100');
        api.LMSSetValue('cmi.core.score.raw', String(score));
        api.LMSSetValue('cmi.core.lesson_status', status);
        api.LMSCommit('');
        console.log('[SCORM API] Puan ve statü LMS\'e iletildi.');
        return true;
      } catch (e) {
        console.warn('[SCORM API] Puan kaydetme hatası:', e);
      }
      return false;
    },

    /**
     * Periyodik Veri Taahhüdü (LMSCommit)
     */
    commit: function () {
      try {
        var api = getAPI();
        if (!api || !isInitialized) return false;
        api.LMSCommit('');
        return true;
      } catch (e) {
        console.warn('[SCORM API] LMSCommit hatası:', e);
      }
      return false;
    },

    /**
     * SCORM 1.2 Oturumunu Güvenle Kapat (LMSFinish)
     */
    finish: function () {
      try {
        var api = getAPI();
        if (!api || !isInitialized) return false;
        try { api.LMSCommit(''); } catch (e) {}
        var result = api.LMSFinish('');
        isInitialized = false;
        console.log('[SCORM API] LMSFinish tamamlandı.');
        return true;
      } catch (e) {
        console.warn('[SCORM API] LMSFinish hatası:', e);
      }
      return false;
    },

    /**
     * Standalone (Çevrimdışı) Modda mı?
     */
    isStandaloneMode: function () {
      return isStandalone;
    }
  };

  // Pencere Kapanışında Otomatik LMSFinish Çağrısı
  window.addEventListener('beforeunload', function () {
    try { ScormAPI.finish(); } catch(e) {}
  });
  window.addEventListener('unload', function () {
    try { ScormAPI.finish(); } catch(e) {}
  });

  global.ScormAPI = ScormAPI;

})(typeof window !== 'undefined' ? window : this);
