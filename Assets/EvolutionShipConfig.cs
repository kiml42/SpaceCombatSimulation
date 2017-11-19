using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EvolutionShipConfig : MonoBehaviour {
    public Rigidbody ShipToEvolve;
    public string Tag1 = "Team1";
    public string Tag2 = "Team2";
    public TestCubeChecker TestCube;
    public Transform Location1;
    public Transform Location2;
    public float Location1RandomisationRadius = 0;
    public float Location2RandomisationRadius = 0;
    [Tooltip("Randomise the rotation of all spawned ships")]
    public bool RandomiseRotation = true;
    public float InitialSpeed = 0;
    public float RandomInitialSpeed = 0;
    public string SpaceShipTag = "SpaceShip";
}
