/** Avoid interrupting a form or refreshing a tab nobody is viewing. */
export function canRefreshInBackground(){
 if(!navigator.onLine || document.visibilityState==='hidden')return false;
 const active=document.activeElement;
 return !(active instanceof HTMLElement && active.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]'));
}
