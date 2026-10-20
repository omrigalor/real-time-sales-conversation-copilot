"""Render the app's own vector cloud mark at macOS icon sizes (Pillow required)."""
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent.parent
assets=root/'assets';iconset=assets/'SalesCopilotFresh.iconset'
iconset.mkdir(exist_ok=True)
size=2048
image=Image.new('RGBA',(size,size));mask=Image.new('L',(size,size));draw=ImageDraw.Draw(mask)
draw.rounded_rectangle((128,128,1920,1920),radius=400,fill=255)
gradient=Image.new('RGBA',(size,size));gd=ImageDraw.Draw(gradient)
for y in range(size):
 t=y/(size-1);gd.line((0,y,size,y),fill=(round(0+(1-0)*t),round(161+(118-161)*t),round(224+(211-224)*t),255))
image.paste(gradient,(0,0),mask)
d=ImageDraw.Draw(image)
segments=[((18,53),(8,53),(2,47),(2,38)),((2,38),(2,30),(8,24),(16,24)),((16,24),(18,14),(26,8),(35,9)),((35,9),(42,10),(47,14),(49,20)),((49,20),(57,18),(65,23),(67,31)),((67,31),(75,33),(78,39),(76,45)),((76,45),(75,50),(70,53),(64,53))]
points=[]
for a,b,c,e in segments:
 for i in range(41):
  t=i/40;u=1-t
  x=u**3*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t**3*e[0]
  y=u**3*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t**3*e[1]
  points.append((round(314+x*18),round(448+y*18)))
d.polygon(points,fill='white')
# A microphone distinguishes voice coaching from Pipeline's ascending chart bars.
blue='#0176d3'
d.rounded_rectangle((926,784,1114,1134),radius=94,fill=blue)
d.arc((844,986,1196,1260),start=0,end=180,fill=blue,width=38)
d.rounded_rectangle((844,970,882,1124),radius=19,fill=blue)
d.rounded_rectangle((1158,970,1196,1124),radius=19,fill=blue)
d.rounded_rectangle((1001,1240,1039,1340),radius=19,fill=blue)
d.rounded_rectangle((914,1320,1126,1358),radius=19,fill=blue)
# Both companion apps share the same visible 81.25% tile footprint.
inset_image=Image.new('RGBA',(size,size))
inset_image.alpha_composite(image.resize((1902,1902),Image.Resampling.LANCZOS),(73,73))
image=inset_image
for n in [16,32,64,128,256,512]:
 for scale in [1,2]:
  image.resize((n*scale,n*scale),Image.Resampling.LANCZOS).save(iconset/f'icon_{n}x{n}{"@2x" if scale==2 else ""}.png')
image.resize((1024,1024),Image.Resampling.LANCZOS).save(assets/'blue-cloud-preview.png')
image.resize((1024,1024),Image.Resampling.LANCZOS).save(assets/'SalesCopilotFresh.icns',format='ICNS')
print('Blue cloud icon generated at all macOS sizes.')
