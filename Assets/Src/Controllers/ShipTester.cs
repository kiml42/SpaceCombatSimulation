﻿using Assets.src.Evolution;
using Assets.Src.Evolution;
using Assets.Src.ModuleSystem;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ShipTester : MonoBehaviour {

    public ModuleHub ShipToEvolve;
    public string Genome = "";

    public int MaxTurrets = 10;
    
    public int GenomeLength = 50;

    public ModuleList ModuleList;
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
        var shipInstance = Instantiate(ShipToEvolve, randomPlacement, orientation);

        var genomeWrapper = new GenomeWrapper(Genome, new List<string>())
        {
            MaxTurrets = MaxTurrets
        };

        shipInstance.Configure(genomeWrapper);
    }
}
