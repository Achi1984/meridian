export function markPaperPosition(position,price,feeBps,{openingFeeAlreadyBooked=false}={}){
  const entry=Number(position?.entry);
  const qty=Number(position?.qty);
  const livePrice=Number(price);
  const bps=Number(feeBps);
  const side=String(position?.side||'').toUpperCase();
  if(!Number.isFinite(entry)||entry<=0)throw new Error('invalid paper entry');
  if(!Number.isFinite(qty)||qty<=0)throw new Error('invalid paper quantity');
  if(!Number.isFinite(livePrice)||livePrice<=0)throw new Error('invalid paper mark price');
  if(!Number.isFinite(bps)||bps<0)throw new Error('invalid paper fee bps');
  if(side!=='LONG'&&side!=='SHORT')throw new Error('invalid paper side');
  const direction=side==='LONG'?1:-1;
  const gross=(livePrice-entry)*qty*direction;
  const estimatedCloseFee=livePrice*qty*bps/10000;
  const bookedOpenFee=openingFeeAlreadyBooked?0:Number(position?.feeOpen||0);
  if(!Number.isFinite(bookedOpenFee)||bookedOpenFee<0)throw new Error('invalid paper opening fee');
  return{livePrice,unrealized:gross-bookedOpenFee-estimatedCloseFee};
}
