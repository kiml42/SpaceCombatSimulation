using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class FuelTank : MonoBehaviour {
    public float Fuel;
    public bool BalanceFuelWithParent;
    public FuelTank ParentFuelTank = null;

    public void Start()
    {
        if (BalanceFuelWithParent)
        {
            FindOtherComponents(transform);
        }
    }

    public float GetAvailableFuel()
    {
        var fuelIncludingFromParent = Fuel;
        if (BalanceFuelWithParent && ParentFuelTank != null)
        {
            fuelIncludingFromParent += ParentFuelTank.GetAvailableFuel();
        }
        return fuelIncludingFromParent;
    }

    public float DrainFuel(float requestedFuel)
    {
        //Fuel balancing isn't going to work like this, so I'm going to drop this on a branch, unitill I figure out a way to make it work.
        var fuelIncludingFromParent = GetAvailableFuel();

        if (fuelIncludingFromParent <= 0)
        {
            return 0;
        }
        var fuelToReturn = Math.Min(requestedFuel, Fuel);
        fuelIncludingFromParent -= fuelToReturn;

        if (BalanceFuelWithParent && ParentFuelTank != null)
        {
            Fuel -= fuelToReturn / 2;
            ParentFuelTank.DrainFuel(fuelToReturn / 2);
        }
        else
        {
            Fuel = fuelIncludingFromParent;
        }

        return fuelToReturn;
    }

    private void FindOtherComponents(Transform transform)
    {
        if (ParentFuelTank == null)
        {
            var parent = transform.parent;
            if (parent == null)
            {
                //At the top, stop searching.
                return;
            }
            //first object found with a fuel tank
            ParentFuelTank = parent.GetComponent("FuelTank") as FuelTank;

            //continue searching for parent fuel tank - don't worry if we've just set it, it'll just return.
            FindOtherComponents(parent);
            return;
        } else
        {
            return;
        }
    }
}
