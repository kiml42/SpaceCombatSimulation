# SpaceCombatSimulation
A Unity 3D project to simulate combat between space ships with vaguely realistic physics - Space ships are not aeroplanes!

Contribution:
Anyone is welcome to contribute to this project,. I would prefer that any changes are put on a pull request for me before being merged onto master.

Controls (such as they are):
Z - make the ship cam follow a different object.
R - cycle reticle state

TODO:
Ships start moving towards each other + small random velocity.
FuelTank option to balance fuel with parent.
Engine plumes emission rate should be proportional to throttle.
Use torquers(including engines) to halt rotation (instead of relying on angular drag hack).
Draws should be penalised less if the ships killed each other simultaneously. probably give them the win score - some constant.
Colour projectiles the same as teh ship.
Prevent friendly fire - all turrets and missiles.
Target shooting evolution
Fighters - using engines as weapons/using guns/both.
projectiles apply force to cancel lateral V. Target set on projectile when fired.
Pass damage up option for health controller
Destructin only leaves objects with a rigibdbody and a health controller
Spherical modules with two angles given for where to spawn the sub modules and something to specify termination of that module's spawning (going back up to the previous)

shipCam:
    Make shipcam move faster if the followed object is faster or add a set chunk to the location based on the followed object's speed. - done
        Aternatively make the shipcam have a rigidbody and actually accelerate up to the speed of the tracked object.   - may still want to do this for continuing to track dead things.
    only watch torpedoes instead of other ships when they are close.
    Continue tracking a dead object a while to see it explode and any subsequent effects.

Camera controller should allow panning also - moot for ship cam
Camera controller to handle zoom - active when camera is active - moot for shipcam
improve muzzle flashes.
Make mini type 2 actually manage to hit torpedoes.
Handle very high speed collisions -sort of done.

Bugs:
Graphical - Beams don't turn off when the turret dies.
"Can't remove Rigidbody because HingeJoint depends on it"

Limerick;
There once was a man from Toronto
Who needed a rhyming word pronto
He wanted to be 
In a limerick, see
So he named his daughter McGonto