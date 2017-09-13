# SpaceCombatSimulation
A Unity 3D project to simulate combat between space ships with vaguely realistic physics - Space ships are not aeroplanes!

TODO:
Engines handle their own fuel. - possibly by accessing the fuel number on the ship or rocket controller.
Target shooting evolution
Fighters - using engines as weapons/using guns/both.
projectiles apply force to cancel lateral V. Target set on projectile when fired.
Health bars
Pass damage up option for health controller

shipCam:
    Make shipcam move faster if the followed object is faster or add a set chunk to the location based on the followed object's speed. - done
        Aternatively make the shipcam have a rigidbody and actually accelerate up to the speed of the tracked object.   - may still want to do this for continuing to track dead things.
    only watch torpedoes instead of other ships when they are close.
    Continue tracking a dead object a while to see it explode and any subsequent effects.

Camera controller should allow panning also - moot for ship cam
Camera controller to handle zoom - active when camera is active - moot for shipcam
Engines only fire when pointed in the right direction.
improve muzzle flashes.
Make mini type 2 actually manage to hit torpedoes.
Handle very high speed collisions -sort of done.
use engines to turn.

Bugs:
Graphical - Beams don't turn off when the turret dies.
"Can't remove Rigidbody because HingeJoint depends on it"