"""Raster toolbar sizes matching the approved 512px Plan A SVG geometry."""
from pathlib import Path
from PIL import Image, ImageDraw
import json

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024
SCALE = SIZE / 512

def gradient(start, end, a, b):
    image = Image.new('RGBA', (SIZE, SIZE))
    pixels = image.load()
    dx, dy = b[0]-a[0], b[1]-a[1]
    denominator = dx*dx+dy*dy
    for y in range(SIZE):
        for x in range(SIZE):
            t = max(0, min(1, ((x/SCALE-a[0])*dx+(y/SCALE-a[1])*dy)/denominator))
            pixels[x,y] = tuple(round(u+(v-u)*t) for u,v in zip(start,end))+(255,)
    return image

def box(values):
    return tuple(round(v*SCALE) for v in values)

image = gradient((41,43,45),(25,27,28),(35,20),(480,512))
mask = Image.new('L',(SIZE,SIZE))
ImageDraw.Draw(mask).rounded_rectangle((0,0,SIZE-1,SIZE-1), radius=108*SCALE, fill=255)
image.putalpha(mask)
draw = ImageDraw.Draw(image)

def cubic(p0,p1,p2,p3):
    points=[]
    for i in range(65):
        t=i/64;u=1-t
        points.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return points

corners=[
    [(102,202)]+cubic((102,151.398),(102,123.687),(123.687,102),(151.398,102))+[(202,102)],
    [(310,102)]+cubic((360.602,102),(388.313,102),(410,123.687),(410,151.398))+[(410,202)],
    [(102,310)]+cubic((102,360.602),(102,388.313),(123.687,410),(151.398,410))+[(202,410)],
]
for points in corners:
    draw.line([(round(x*SCALE),round(y*SCALE)) for x,y in points],fill='white',width=round(28*SCALE),joint='curve')
    for x,y in (points[0],points[-1]):
        draw.ellipse(box((x-14,y-14,x+14,y+14)),fill='white')

accent=gradient((52,123,255),(36,96,235),(305,310),(426.828,431.828))
accent_mask=Image.new('L',(SIZE,SIZE))
ImageDraw.Draw(accent_mask).rounded_rectangle(box((305,310,418,423)),radius=21.188*SCALE,fill=255)
image.paste(accent,(0,0),accent_mask)
out=ROOT/'extension'/'icons'
out.mkdir(exist_ok=True)
for size in (16,32,48,128):
    image.resize((size,size),Image.Resampling.LANCZOS).save(out/f'icon{size}.png')
manifest_path=ROOT/'extension'/'manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['icons']={str(size):f'icons/icon{size}.png' for size in (16,32,48,128)}
manifest['action']['default_icon']=manifest['icons'].copy()
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('Created toolbar icons: 16, 32, 48, 128 px')
