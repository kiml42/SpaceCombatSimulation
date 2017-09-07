# SpaceCombatSimulation
A Unity 3D project to simulate combat between space ships with vaguely realistic physics - Space ships are not aeroplanes!

TODO:
Engines handle their own fuel. - possibly by accessing the fuel number on the ship or rocket controller.
Improve generation management (1v1 evolution) - make it a bit more random.
Target shooting evolution

Make beams look glowy

shipCam:
****    Make shipSam point at the target of the followed object (if there is one)
    Make shipcam know what it's following, and not try follow other things that happen to get closer.
    Make shipcam use targetpickers - will need a list of all tags, and to know the currently followed object.
    Make shipcam move faster if the followed object is faster or add a set chunk to the location based on the followed object's speed.
        Aternatively make the shipcam have a rigidbody and actually accelerate up to the speed of the tracked object.
    Make shipcam's focus object always be in front of shipcam, so you don't get weird effects of zooming out then in as it goes past.
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
If tangential velocity(Vt) is too low, trying to turn to add to it, creates Vt in the opposite direction, this leads to endless indecision about which way to go. - Fixed, I think (uses forward orientation of ship at very low speeds.)