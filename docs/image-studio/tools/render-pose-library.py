"""Original procedural pose references. Run with Blender --background --python.
All views of a pose share the same geometry; only the camera changes.
No downloaded anatomy meshes, clothing, or source-project assets are used.
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector
OUT=Path(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else Path('/tmp/newapi-studio-assets-v2-20261109/rendered')
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=768;scene.render.resolution_y=960;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.world.color=(.8,.8,.8)
scene.view_settings.view_transform='AgX'
def mat(name,color,roughness):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=roughness
 return m
body=mat('Neutral grey sculptural mannequin',(.43,.46,.49),.65)
joint=mat('Subtle joint connections',(.37,.40,.43),.75)
floor=mat('Warm white studio',(.87,.86,.83),.88)
def ell(name,loc,scale,material=body):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=loc)
 o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=True
 return o
def link(name,a,b,r1,r2):
 a,b=Vector(a),Vector(b);d=b-a
 bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=r1,radius2=r2,depth=d.length,location=(a+b)/2)
 o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(body)
 bevel=o.modifiers.new('Soft limb edges','BEVEL');bevel.width=.04;bevel.segments=3
 for p in o.data.polygons:p.use_smooth=True
 return o
bpy.ops.mesh.primitive_plane_add(size=200);bpy.context.object.name='floor';bpy.context.object.data.materials.append(floor)
for name,loc,power,size in [('key',(-3,-4,6),650,4),('fill',(4,-1,3),350,4),('rim',(1,3,5),450,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=2.35;camera.data.lens=55
# +Y is rear; -Y is the mannequin's front. Z is up.
base={
 'pelvis':(0,0,.94),'chest':(0,0,1.31),'neck':(0,0,1.52),'head':(0,-.005,1.69),
 'ls':(-.205,0,1.40),'rs':(.205,0,1.40),
 'le':(-.26,-.015,1.13),'re':(.26,-.015,1.13),'lw':(-.27,-.04,.90),'rw':(.27,-.04,.90),
 'lh':(-.105,0,.91),'rh':(.105,0,.91),'lk':(-.115,-.025,.53),'rk':(.115,-.025,.53),'la':(-.12,0,.12),'ra':(.12,0,.12)}
poses={
 'standing':{'pelvis':(.025,0,.94),'re':(.39,.005,1.16),'rw':(.17,-.06,1.01),'rk':(.18,-.08,.52),'ra':(.24,-.10,.12)},
 'walking':{'le':(-.24,.13,1.14),'lw':(-.22,.22,.92),'re':(.23,-.15,1.17),'rw':(.21,-.30,1.02),'lk':(-.12,-.20,.55),'la':(-.13,-.35,.12),'rk':(.13,.19,.55),'ra':(.14,.32,.14)},
 'seated':{'pelvis':(0,.05,.62),'chest':(0,.04,.99),'neck':(0,.04,1.20),'head':(0,.03,1.37),'ls':(-.205,.04,1.08),'rs':(.205,.04,1.08),'le':(-.25,-.12,.84),'re':(.25,-.12,.84),'lw':(-.14,-.34,.70),'rw':(.14,-.34,.70),'lh':(-.105,.03,.60),'rh':(.105,.03,.60),'lk':(-.14,-.34,.59),'rk':(.14,-.34,.59),'la':(-.15,-.36,.12),'ra':(.15,-.36,.12)},
 'reaching':{'re':(.29,-.02,1.68),'rw':(.18,-.03,1.94)},
 'turning':{},
 'dynamic':{'pelvis':(-.04,0,.85),'chest':(-.04,0,1.22),'neck':(-.04,0,1.43),'head':(-.04,-.005,1.60),'ls':(-.245,0,1.31),'rs':(.165,0,1.31),'le':(-.36,-.09,1.06),'lw':(-.39,-.13,.90),'re':(.44,0,1.34),'rw':(.70,0,1.32),'lh':(-.145,0,.82),'rh':(.065,0,.82),'lk':(-.36,-.10,.52),'rk':(.34,0,.48),'la':(-.44,-.02,.12),'ra':(.62,0,.12)},
}
views={'original':(30,10),'front':(0,6),'side':(90,6),'back':(180,6)}
manifest=[]
for pose,change in poses.items():
 existing=set(bpy.data.objects)
 p={**base,**change}
 ell('pelvis',p['pelvis'],(.155,.105,.16))
 ell('abdomen',tuple((Vector(p['pelvis'])+Vector(p['chest']))/2),(.13,.085,.20))
 ell('ribcage',p['chest'],(.205,.115,.225))
 link('neck',Vector(p['neck'])-Vector((0,0,.05)),p['head'],.052,.052)
 head=ell('featureless head',p['head'],(.105,.095,.14))
 if pose=='turning':head.rotation_euler[2]=math.radians(75)
 # A tiny nose wedge establishes orientation without identity or facial detail.
 offset=Vector((0,-.092,0));
 if pose=='turning':offset.rotate(head.rotation_euler)
 ell('face direction',Vector(p['head'])+offset,(.022,.018,.028))
 for side in ['l','r']:
  for key,rad in [('s',.067),('e',.048),('w',.035),('h',.079),('k',.058),('a',.039)]:ell(side+key,p[side+key],(rad,rad,rad),joint)
  link(side+'upper arm',p[side+'e'],p[side+'s'],.052,.068)
  link(side+'forearm',p[side+'w'],p[side+'e'],.034,.050)
  handdir=(Vector(p[side+'w'])-Vector(p[side+'e'])).normalized()
  hand=ell(side+'hand',Vector(p[side+'w'])+handdir*.065,(.038,.027,.080));hand.rotation_euler=handdir.to_track_quat('Z','Y').to_euler()
  link(side+'thigh',p[side+'k'],p[side+'h'],.065,.090)
  link(side+'shin',p[side+'a'],p[side+'k'],.038,.061)
  ankle=Vector(p[side+'a']);ell(side+'foot',ankle+Vector((0,-.065,-.055)),(.052,.115,.05))
 if pose=='seated':
  bpy.ops.mesh.primitive_cube_add(size=1,location=(0,.04,.27));o=bpy.context.object;o.name='seat';o.scale=(.45,.40,.54);o.data.materials.append(floor);b=o.modifiers.new('seat bevel','BEVEL');b.width=.02;b.segments=3
 pose_objects=set(bpy.data.objects)-existing
 coordinates={k:list(v) for k,v in p.items()}
 for view,(az,el) in views.items():
  target=Vector((0,-.05,.91));az=math.radians(az);el=math.radians(el)
  camera.location=target+Vector((math.sin(az)*5*math.cos(el),-math.cos(az)*5*math.cos(el),5*math.sin(el)))
  camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
  scene.render.filepath=str(OUT/f'{pose}-{view}.png');bpy.ops.render.render(write_still=True)
  manifest.append({'pose':pose,'view':view,'camera':list(camera.location),'joints':coordinates,'file':f'{pose}-{view}.png'})
 for o in pose_objects:bpy.data.objects.remove(o,do_unlink=True)
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
