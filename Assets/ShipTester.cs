using Assets.src.Evolution;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ShipTester : MonoBehaviour {

    public Rigidbody ShipToEvolve;
    public string Genome = "";

    public int MaxTurrets = 10;

    public int MaxShootAngle = 180;
    public int MaxLocationAimWeighting = 10;
    public int MaxSlowdownWeighting = 60;
    public int MaxLocationTollerance = 1000;
    public int MaxVelociyTollerance = 200;
    public int MaxAngularDragForTorquers = 1;

    public int GenomeLength = 50;

    public List<Rigidbody> Modules;
    private Rigidbody Ship;
    private string _previousGenome;

    // Use this for initialization
    void Start()
    {
        if(Genome.Length > GenomeLength)
        {
            Genome = Genome.Substring(0, GenomeLength);
        } else if(Genome.Length < GenomeLength)
        {
            Genome = Genome.PadRight(GenomeLength, ' ');
        }
        _previousGenome = Genome;
        SpawnShip();
    }

    private void Update()
    {
        if(Genome != _previousGenome)
        {
            //GameObject.Destroy(Ship);
            //transform.Translate(new Vector3(0, 0, 200));
            Start();

        }
    }

    private void SpawnShip()
    {
        var orientation = transform.rotation;
        var randomPlacement = transform.position;
        Ship = Instantiate(ShipToEvolve, randomPlacement, orientation);

        new ShipBuilder(Genome, Ship.transform, Modules)
        {
            MaxShootAngle = MaxShootAngle,
            MaxLocationAimWeighting = MaxLocationAimWeighting,
            MaxSlowdownWeighting = MaxSlowdownWeighting,
            MaxMaxAndMinRange = MaxLocationTollerance,
            MaxVelociyTollerance = MaxVelociyTollerance,
            MaxAngularDragForTorquers = MaxAngularDragForTorquers,
            MaxTurrets = MaxTurrets
        }.BuildShip();
    }
}
