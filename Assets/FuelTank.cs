using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class FuelTank : MonoBehaviour {
    public float Fuel;

    public float DrainFuel(float requestedFuel)
    {
        if(Fuel <= 0)
        {
            return 0;
        }
        var fuelToReturn = Math.Min(requestedFuel, Fuel);
        Fuel -= fuelToReturn;
        return fuelToReturn;
    }
}
