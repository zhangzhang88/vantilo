'use strict';
const READER_SESSION_COOKIE='__Host-vantilo-reader';
function readerSessionCookies(getSession) {
  return {
    installSessionCookie: (token,origin) => getSession().cookies.set({url:origin,name:READER_SESSION_COOKIE,value:token,path:'/',httpOnly:true,secure:true,sameSite:'no_restriction'}),
    clearSessionCookie: origin => getSession().cookies.remove(origin,READER_SESSION_COOKIE),
  };
}
module.exports={READER_SESSION_COOKIE,readerSessionCookies};
