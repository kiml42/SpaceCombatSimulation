# SpaceCombatSimulation
A Unity 3D project to simulate combat between space ships with vaguely realistic physics - Space ships are not aeroplanes!

Contribution:
Anyone is welcome to contribute to this project,. I would prefer that any changes are put on a pull request for me before being merged onto master.

Controls (such as they are):
Z - make the ship cam follow a different object.
R - cycle reticle state

Bugs:
    Priority:
        Account for location of starting module when avoiding overlapping modules.
        "Can't remove Rigidbody because HingeJoint depends on it"
        rocket engines carry on regardless if the rocket has no target.
    Graphical - Beams don't turn off when the turret dies. - haven't seen this one in a while.
    Rocket engine plumes start on
    

TODO:
    Priority:
        Turret friction without using angular drag.
            Mostly implemented, need to check the velocity multipliers on the little turrets to improve their responsiveness.
        Some way for turrets to account for their own turn rates.
        Handle very high speed collisions -sort of done.
            new idea Projectiles cast a ray from previous position to current position jump to location of a hit, forcing a physics collision.
                This works but is damn heavy
            Plan C - have a trigger going behind the projectile and only cast the ray if that collides. (or use the collision point, if that's a thing.)
        Railgun turret
            Single beam beam turret with very short on, long reload and huge damage ignoring range.
        Use torquers(including engines) to halt rotation (instead of relying on angular drag hack).
        Refactor rocket controller's start delay feature.
        Some way to set the roll of ships to have a direction that should be pointed at the enemy where possible.
        Spherical trigger around missiles that puts them into max evasion mode regardless of velocity
        Fighters - using engines as weapons/using guns/both.
        Destruction only leaves objects with a rigibdbody and a health controller
        TargetPickers have option to kull all but the best x.
        improve muzzle flashes.
            Create a muzzle flash prefab that is spawned with no additional velocity, or even parented to emitter
        Prevent fluttery torpedoes.
        Make turrets account for the thing they're on's rotation.
        Eyeball turret


    allow components in the same cubic volume if they wouldn't intersect.
    Turrets should know the ways they cannot turn.
    Store full config of evolution in current generation file.
    Draws should be penalised less if the ships killed each other simultaneously. probably give them the win score - some constant.
    Target shooting evolution
    projectiles apply force to cancel lateral V. Target set on projectile when fired.
    Spherical modules with two angles given for where to spawn the sub modules and something to specify termination of that module's spawning (going back up to the previous)
    FuelTank option to balance fuel with parent.

    Use fixed update for time critical scripts, update for others


    Repulsive shield- repells objects in trigger

    shipCam:
        Make shipcam move faster if the followed object is faster or add a set chunk to the location based on the followed object's speed. - done
            Aternatively make the shipcam have a rigidbody and actually accelerate up to the speed of the tracked object.   - may still want to do this for continuing to track dead things.
        only watch torpedoes instead of other ships when they are close.
        Continue tracking a dead object a while to see it explode and any subsequent effects.

    Camera controller should allow panning also - moot for ship cam
    Camera controller to handle zoom - active when camera is active - moot for shipcam
    Make mini type 2 actually manage to hit torpedoes.
    Just set a single name for evolution files (all types) and have it work out the folders from there.
        Done for 1v1 evolution

    From Endarren:
        Option to just disable the object at zero health, instead of destroying it.

        I would suggest using Scriptable Objects to hold data, such as projectile speed and damage. This would save memory, since you wouldn't have duplicate data in objects.

        You might want to make the OnCollisionEnter for HealthController do some checks to make sure certain colliders do not accidently do damage.
            HealthController ignores certian tags, but the collisions with any force field still wreck things by physics.

Balance:
    Cluster torpedoes do practically no damage, even when some of the submunitions hit, which happens quite rarely.
    Big lasers should be capable at a bit of a longer range, and a little less up close.

Limerick;
There once was a man from Toronto
Who needed a rhyming word pronto
He wanted to be 
In a limerick, see
So he named his daughter McGonto