/** Server-rendered brand artwork; no external image/font fetches. */
export function ShareImage({ title, subtitle='Praktik bələdçi · Azərbaycan dilində' }: {title:string;subtitle?:string}) {
  return <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:64,background:'#F6F7F0',color:'#253B2C'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><span style={{fontSize:44,fontWeight:700}}>AISE</span><span style={{fontSize:22,borderRadius:24,padding:'12px 22px',background:'#D2F77C'}}>Karyera bələdçisi</span></div>
    <div style={{display:'flex',flexDirection:'column',gap:22}}><div style={{fontSize:56,fontWeight:700,lineHeight:1.15}}>{title}</div><div style={{fontSize:25,color:'#667064'}}>{subtitle}</div></div>
    <div style={{display:'flex',justifyContent:'space-between',fontSize:22,borderTop:'2px solid #253B2C',paddingTop:22}}><span>Oxu. Sına. Müraciətinə tətbiq et.</span><span>aisehr.com</span></div>
  </div>;
}
