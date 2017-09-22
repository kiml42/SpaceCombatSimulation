# SpaceCombatSimulation
A Unity 3D project to simulate combat between space ships with vaguely realistic physics - Space ships are not aeroplanes!

Contribution:
Anyone is welcome to contribute to this project,. I would prefer that any changes are put on a pull request for me before being merged onto master.

Controls (such as they are):
Z - make the ship cam follow a different object.
R - cycle reticle state

TODO:
    Just set a single name for evolution files (all types) and have it work out the folders from there.
    Store full config of evolution in current generation file.
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

    From Endarren:
        Option to just disable the object at zero health, instead of destroying it.

        I would suggest when you spawn in projectile that you parent them to an empty game object. That way, the project heirchy is not messy. I wrote up a Projectile script that does that. I made a fork of this project and put the script in it. You can find it here https://github.com/Endarren/SpaceCombatSimulation/blob/master/Assets/src/Projectile.cs

        I would suggest using Scriptable Objects to hold data, such as projectile speed and damage. This would save memory, since you wouldn't have duplicate data in objects.

        I would suggest using a different method to detect enemies. GameObject.FindGameObjectsWithTag is not very effiecent.
            My current idea is to have every bahaviour register it's self as a PotentialTarget with a static class that everything will ask for targets.

        To make it more customizable, it would be nice if the turret turn speeds were changable in the inspector.

        You might want to make the OnCollisionEnter for HealthController do some checks to make sure certain colliders do not accidently do damage.
            Health controller should ignore triggers, but a trigger wouldn't be seen by the beams, so I'll probably approach this by having a tag on the shield that health controller is told to ignore.


Bugs:
    Graphical - Beams don't turn off when the turret dies.
    "Can't remove Rigidbody because HingeJoint depends on it"

Limerick;
There once was a man from Toronto
Who needed a rhyming word pronto
He wanted to be 
In a limerick, see
So he named his daughter McGonto